// ARC Stash Tracker: a minimal native shell around the tracker page, using the Edge WebView2
// runtime that ships with Windows. The page (app/) does all the work; this host only provides
// what a web page can't: a window, a signed-in MetaForge session, the data cache on disk,
// opening links and notifications. Build with shell\build.ps1 (C# 5, .NET Framework 4.8).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

static class Program
{
    public const string Title = "ARC Stash Tracker";
    public const string AppHost = "app.arcstash";
    public const string MetaForge = "https://metaforge.app";

    [DllImport("user32.dll")] static extern IntPtr FindWindow(string cls, string title);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int cmd);

    [STAThread]
    static void Main(string[] args)
    {
        if (Array.IndexOf(args, "--uninstall") >= 0) { Uninstall(Array.Exists(args, a => a.Equals("/S", StringComparison.OrdinalIgnoreCase))); return; }
        // .NET Framework apps without a target-framework config fall back to SSL3/TLS 1.0, which the
        // data sources reject ("Could not create SSL/TLS secure channel"). Allow TLS 1.2 and 1.3.
        System.Net.ServicePointManager.SecurityProtocol = System.Net.SecurityProtocolType.Tls12 | (System.Net.SecurityProtocolType)12288;
        bool first;
        using (var mutex = new Mutex(true, "ArcStashTracker.SingleInstance" + (Environment.GetEnvironmentVariable("ARC_SELFTEST") != null ? ".SelfTest" : ""), out first))
        {
            if (!first)
            {
                // Already running: bring that window forward instead of starting a second copy.
                var h = FindWindow(null, Title);
                if (h != IntPtr.Zero) { ShowWindow(h, 9); SetForegroundWindow(h); }
                return;
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm());
        }
    }

    // Apps & features runs "ArcStash.exe --uninstall" (add /S for silent). Removes the program, its
    // shortcuts and its uninstall entry; your data folders are left in place.
    static void Uninstall(bool silent)
    {
        var dir = Path.GetFullPath(AppDomain.CurrentDomain.BaseDirectory).TrimEnd('\\');
        var expected = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", Title);
        if (!dir.Equals(expected, StringComparison.OrdinalIgnoreCase))
        {
            if (!silent) MessageBox.Show("This copy isn't installed in " + expected + ", so there's nothing to uninstall.", Title);
            return;
        }
        if (!silent && MessageBox.Show("Remove " + Title + "?\n\nYour item data and MetaForge sign-in stay in:\n" +
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), Title) + "\n" +
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), Title) +
                "\nDelete those folders yourself to remove everything.", Title, MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
        foreach (var p in Process.GetProcessesByName("ArcStash"))
        {
            try { if (p.Id != Process.GetCurrentProcess().Id && p.MainModule.FileName.StartsWith(dir, StringComparison.OrdinalIgnoreCase)) { p.Kill(); p.WaitForExit(5000); } } catch { }
        }
        foreach (var lnk in new[] {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), Title + ".lnk"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), Title + ".lnk") })
            try { File.Delete(lnk); } catch { }
        try { Microsoft.Win32.Registry.CurrentUser.DeleteSubKeyTree(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\ArcStashTracker", false); } catch { }
        // This exe can't delete its own folder while running: hand that to cmd once we've exited.
        Process.Start(new ProcessStartInfo("cmd.exe", "/c ping -n 3 127.0.0.1 >nul & rmdir /s /q \"" + dir + "\"") { CreateNoWindow = true, UseShellExecute = false, WindowStyle = ProcessWindowStyle.Hidden });
        if (!silent) MessageBox.Show(Title + " was removed.", Title);
    }
}

class MainForm : Form
{
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
    static readonly HttpClient Http = new HttpClient();
    // The page only ever stores a few JSON files (cache, price history, migrated state).
    static readonly Regex SafeName = new Regex(@"^[a-z0-9][a-z0-9\-]{0,50}\.json$");
    static readonly string[] AllowedGets = { "https://metaforge.app/api/", "https://arcraiders.wiki/w/api.php" };

    readonly string baseDir = AppDomain.CurrentDomain.BaseDirectory;
    readonly string selfTest = Environment.GetEnvironmentVariable("ARC_SELFTEST");
    readonly string dataDir, profileDir;
    readonly WebView2 view = new WebView2();
    readonly WebView2 mfView = new WebView2();      // hidden page on metaforge.app that makes your signed-in requests
    readonly Dictionary<string, TaskCompletionSource<string>> mfPending = new Dictionary<string, TaskCompletionSource<string>>();
    readonly NotifyIcon tray = new NotifyIcon();
    CoreWebView2Environment env;
    Task mfReady;
    int mfSeq;

    public MainForm()
    {
        var roaming = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        // The data cache stays where the previous version kept it, so prices and history carry over.
        dataDir = selfTest != null ? Path.Combine(selfTest, "profile", "data") : Path.Combine(roaming, Program.Title, "data");
        profileDir = selfTest != null ? Path.Combine(selfTest, "profile", "webview") : Path.Combine(local, Program.Title, "WebView2");
        Directory.CreateDirectory(dataDir);

        Text = Program.Title;
        BackColor = Color.FromArgb(11, 14, 21);
        var iconPath = Path.Combine(baseDir, "icon.ico");
        if (File.Exists(iconPath)) Icon = new Icon(iconPath);
        var area = Screen.PrimaryScreen.WorkingArea;
        float scale = DeviceDpi / 96f;
        Size = new Size(Math.Min((int)(1440 * scale), area.Width), Math.Min((int)(900 * scale), area.Height));
        MinimumSize = new Size((int)(980 * scale), (int)(640 * scale));
        StartPosition = FormStartPosition.CenterScreen;

        view.Dock = DockStyle.Fill;
        view.DefaultBackgroundColor = BackColor;
        // A WebView2 needs a real window to run, so the MetaForge page is a 1x1 control behind the main view.
        mfView.Size = new Size(1, 1);
        mfView.Location = new Point(0, 0);
        Controls.Add(mfView);
        Controls.Add(view);
        view.BringToFront();
        tray.Icon = Icon ?? SystemIcons.Application;
        tray.Text = Program.Title;
        RestoreWindow();
        Load += async (s, e) => await Init();
        FormClosing += (s, e) => SaveWindow();
        FormClosed += (s, e) => tray.Dispose();
    }

    // Remember size, position and maximized state between launches (kept next to the WebView2 profile).
    string WindowFile { get { return Path.Combine(profileDir, "..", "window.txt"); } }
    void RestoreWindow()
    {
        try
        {
            var p = File.ReadAllText(WindowFile).Split(',');
            var r = new Rectangle(int.Parse(p[0]), int.Parse(p[1]), int.Parse(p[2]), int.Parse(p[3]));
            // Only restore onto a screen that still exists (monitors get unplugged).
            if (Array.Exists(Screen.AllScreens, sc => sc.WorkingArea.IntersectsWith(r)) && r.Width >= MinimumSize.Width && r.Height >= MinimumSize.Height)
            {
                StartPosition = FormStartPosition.Manual;
                Bounds = r;
                if (p.Length > 4 && p[4] == "max") WindowState = FormWindowState.Maximized;
            }
        }
        catch { /* first launch or unreadable: keep the centered default */ }
    }
    void SaveWindow()
    {
        if (selfTest != null) return;
        try
        {
            var r = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(WindowFile)));
            File.WriteAllText(WindowFile, r.X + "," + r.Y + "," + r.Width + "," + r.Height + "," + (WindowState == FormWindowState.Maximized ? "max" : "normal"));
        }
        catch { }
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        int dark = 1; // dark title bar to match the app
        DwmSetWindowAttribute(Handle, 20, ref dark, 4);
    }

    async Task Init()
    {
        var opts = new CoreWebView2EnvironmentOptions("--disable-features=msSmartScreenProtection");
        env = await CoreWebView2Environment.CreateAsync(null, profileDir, opts);
        await view.EnsureCoreWebView2Async(env);
        var core = view.CoreWebView2;
        core.Settings.AreDevToolsEnabled = selfTest != null;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.IsZoomControlEnabled = false;
        // No browser shortcuts (print, reload, find bar), autofill or password saving in the app window.
        core.Settings.AreBrowserAcceleratorKeysEnabled = selfTest != null;
        core.Settings.IsGeneralAutofillEnabled = false;
        core.Settings.IsPasswordAutosaveEnabled = false;
        core.SetVirtualHostNameToFolderMapping(Program.AppHost, Path.Combine(baseDir, "app"), CoreWebView2HostResourceAccessKind.Deny);
        core.WebMessageReceived += OnAppMessage;
        // Links from the tracker open in your normal browser.
        core.NewWindowRequested += (s, e) => { e.Handled = true; OpenExternal(e.Uri); };
        core.NavigationStarting += (s, e) => { if (!e.Uri.StartsWith("https://" + Program.AppHost + "/")) { e.Cancel = true; OpenExternal(e.Uri); } };
        mfReady = InitMetaForgeView();
        core.Navigate("https://" + Program.AppHost + "/index.html");
        if (selfTest != null) { var t = SelfTest(); }
    }

    // ---------- MetaForge session ----------
    // Requests run inside a hidden page on metaforge.app, so the browser handles your sign-in
    // cookies (including refreshes) exactly as it does on the website.
    async Task InitMetaForgeView()
    {
        await mfView.EnsureCoreWebView2Async(env);
        var c = mfView.CoreWebView2;
        c.Settings.AreDevToolsEnabled = false;
        c.WebMessageReceived += (s, e) =>
        {
            // Only replies from our own fetch script on metaforge.app count.
            if (!e.Source.StartsWith(Program.MetaForge + "/")) return;
            Dictionary<string, object> msg;
            try { msg = Json.Deserialize<Dictionary<string, object>>(e.TryGetWebMessageAsString()); } catch { return; }
            if (msg == null || !msg.ContainsKey("rid")) return;
            var rid = msg["rid"] as string;
            TaskCompletionSource<string> tcs;
            if (rid != null && mfPending.TryGetValue(rid, out tcs)) { mfPending.Remove(rid); tcs.TrySetResult(e.TryGetWebMessageAsString()); }
        };
        var done = new TaskCompletionSource<bool>();
        c.NavigationCompleted += (s, e) => done.TrySetResult(true);
        c.Navigate(Program.MetaForge + "/robots.txt");
        await done.Task;
    }

    // The only MetaForge requests the app makes with your sign-in. Anything else (trades, profile,
    // other games) is refused, so a bug or injected script in the page can't act on your account.
    static readonly Regex MfGet = new Regex(@"^/api/arc-raiders/(account-sync|embark/oauth/status|embark/app-auth/[A-Za-z0-9/_\-]+)(\?[^\s#]*)?$");
    static readonly Regex MfPost = new Regex(@"^/api/arc-raiders/(inventory/live\?persist=1|workshop/sync|projects/sync|quests/sync|player-stats/sync|embark/app-auth/start)$");

    async Task<string> MetaForgeFetch(string path, string method, string body, string contentType)
    {
        method = (method ?? "GET").ToUpperInvariant();
        if (path == null || !((method == "GET" && MfGet.IsMatch(path)) || (method == "POST" && MfPost.IsMatch(path))))
            throw new Exception("MetaForge request not allowed: " + method + " " + path);
        if (body != null && body.Length > 4096) throw new Exception("Request body too large");
        await mfReady;
        var rid = "r" + (++mfSeq);
        var tcs = new TaskCompletionSource<string>();
        mfPending[rid] = tcs;
        var init = new Dictionary<string, object> { { "method", method }, { "cache", "no-store" }, { "credentials", "include" } };
        var headers = new Dictionary<string, object> { { "Accept", "application/json" } };
        if (contentType != null) headers["Content-Type"] = contentType;
        init["headers"] = headers;
        if (body != null) init["body"] = body;
        var script = "(async()=>{let r;try{const res=await fetch(" + Json.Serialize(path) + "," + Json.Serialize(init) + ");" +
            "r={rid:" + Json.Serialize(rid) + ",status:res.status,text:await res.text()}}catch(e){r={rid:" + Json.Serialize(rid) + ",status:0,text:String(e)}}" +
            "window.chrome.webview.postMessage(JSON.stringify(r))})()";
        await mfView.CoreWebView2.ExecuteScriptAsync(script);
        var finished = await Task.WhenAny(tcs.Task, Task.Delay(30000));
        if (finished != tcs.Task) { mfPending.Remove(rid); throw new Exception("MetaForge did not respond"); }
        return tcs.Task.Result;
    }

    Task MetaForgeLogin()
    {
        var closed = new TaskCompletionSource<bool>();
        var f = new Form { Text = "Sign in to MetaForge", Size = new Size(Width * 3 / 4, Height * 9 / 10), StartPosition = FormStartPosition.CenterParent, BackColor = BackColor, Icon = Icon };
        var wv = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = BackColor };
        f.Controls.Add(wv);
        f.HandleCreated += (s, e) => { int dark = 1; DwmSetWindowAttribute(f.Handle, 20, ref dark, 4); };
        f.Shown += async (s, e) =>
        {
            await wv.EnsureCoreWebView2Async(env);
            wv.CoreWebView2.NewWindowRequested += (s2, e2) => { e2.Handled = true; wv.CoreWebView2.Navigate(e2.Uri); };
            wv.CoreWebView2.Navigate(Program.MetaForge + "/arc-raiders/needed-items");
        };
        f.FormClosed += (s, e) => { wv.Dispose(); closed.TrySetResult(true); };
        f.Show(this);
        return closed.Task;
    }

    async Task MetaForgeLogout()
    {
        await mfReady;
        mfView.CoreWebView2.CookieManager.DeleteAllCookies();
        await mfView.CoreWebView2.CallDevToolsProtocolMethodAsync("Storage.clearDataForOrigin",
            Json.Serialize(new Dictionary<string, object> { { "origin", Program.MetaForge }, { "storageTypes", "all" } }));
    }

    // ---------- messages from the tracker page ----------
    async void OnAppMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        // Only the tracker page itself may call the host.
        if (!e.Source.StartsWith("https://" + Program.AppHost + "/")) return;
        Dictionary<string, object> msg = null;
        try { msg = Json.Deserialize<Dictionary<string, object>>(e.TryGetWebMessageAsString()); } catch { return; }
        if (msg == null || !msg.ContainsKey("id") || !(msg.ContainsKey("cmd") && msg["cmd"] is string)) return;
        var id = msg["id"];
        var args = msg.ContainsKey("args") ? msg["args"] as Dictionary<string, object> : null;
        if (args == null) args = new Dictionary<string, object>();
        var reply = new Dictionary<string, object> { { "id", id } };
        try
        {
            reply["result"] = await HandleCommand((string)msg["cmd"], args);
            reply["ok"] = true;
        }
        catch (Exception ex)
        {
            reply["ok"] = false;
            reply["error"] = ex.InnerException != null ? ex.InnerException.Message : ex.Message;
        }
        view.CoreWebView2.PostWebMessageAsString(Json.Serialize(reply));
    }

    static string Arg(Dictionary<string, object> a, string k) { object v; return a.TryGetValue(k, out v) && v != null ? v.ToString() : null; }

    async Task<object> HandleCommand(string cmd, Dictionary<string, object> a)
    {
        switch (cmd)
        {
            case "httpGet":
            {
                var url = Arg(a, "url");
                if (url == null || Array.FindIndex(AllowedGets, p => url.StartsWith(p)) < 0) throw new Exception("URL not allowed");
                if (Environment.GetEnvironmentVariable("ARC_SELFTEST_OFFLINE") != null && selfTest != null) throw new Exception("offline (self-test)");
                var req = new HttpRequestMessage(HttpMethod.Get, url);
                req.Headers.TryAddWithoutValidation("User-Agent", "arc-stash-tracker");
                var res = await Http.SendAsync(req);
                if (!res.IsSuccessStatusCode) throw new Exception((int)res.StatusCode + " " + url);
                return await res.Content.ReadAsStringAsync();
            }
            case "readFile":
            {
                var p = DataPath(Arg(a, "name"));
                return File.Exists(p) ? File.ReadAllText(p) : null;
            }
            case "writeFile":
            {
                var p = DataPath(Arg(a, "name"));
                var text = Arg(a, "text") ?? "";
                if (text.Length > 32 * 1024 * 1024) throw new Exception("File too large");
                File.WriteAllText(p + ".tmp", text);
                if (File.Exists(p)) File.Delete(p);
                File.Move(p + ".tmp", p);
                return true;
            }
            case "mfFetch":
                return await MetaForgeFetch(Arg(a, "path"), Arg(a, "method"), Arg(a, "body"), Arg(a, "contentType"));
            case "mfLogin":
                await MetaForgeLogin();
                return true;
            case "mfLogout":
                await MetaForgeLogout();
                return true;
            case "openExternal":
                return OpenExternal(Arg(a, "url"));
            case "notify":
                tray.Visible = true;
                tray.ShowBalloonTip(8000, Arg(a, "title") ?? Program.Title, Arg(a, "body") ?? "", ToolTipIcon.Info);
                return true;
            case "selftest":
                return selfTest != null;
        }
        throw new Exception("Unknown command " + cmd);
    }

    // Windows device names (CON, NUL, COM1...) aren't files even with an extension.
    static readonly Regex ReservedName = new Regex(@"^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)", RegexOptions.IgnoreCase);

    string DataPath(string name)
    {
        if (name == null || !SafeName.IsMatch(name) || ReservedName.IsMatch(name)) throw new Exception("Bad file name");
        return Path.Combine(dataDir, name);
    }

    // Opens https links, and the MetaForge Bridge app link MetaForge hands out for re-authorizing Embark.
    // Returns false for anything else (file:, javascript:, other apps' protocols, malformed links).
    static bool OpenExternal(string url)
    {
        if (url == null || url.Length > 2048 || Regex.IsMatch(url, @"[\s\x00-\x1f""<>]")) return false;
        Uri u;
        var ok = (Uri.TryCreate(url, UriKind.Absolute, out u) && u.Scheme == "https" && !string.IsNullOrEmpty(u.Host))
            || Regex.IsMatch(url, "^metaforge[a-z0-9+.\\-]*:", RegexOptions.IgnoreCase);
        if (ok) Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        return ok;
    }

    // ---------- self-test: ARC_SELFTEST=<dir> -> screenshots of every tab, page errors in <dir>\log.txt ----------
    async Task SelfTest()
    {
        var log = Path.Combine(selfTest, "log.txt");
        File.WriteAllText(log, "");
        var core = view.CoreWebView2;
        core.GetDevToolsProtocolEventReceiver("Runtime.exceptionThrown").DevToolsProtocolEventReceived += (s, e) => File.AppendAllText(log, "EXCEPTION " + e.ParameterObjectAsJson + "\n");
        core.GetDevToolsProtocolEventReceiver("Runtime.consoleAPICalled").DevToolsProtocolEventReceived += (s, e) => { if (e.ParameterObjectAsJson.Contains("\"type\":\"error\"") || e.ParameterObjectAsJson.Contains("\"type\":\"warning\"")) File.AppendAllText(log, "CONSOLE " + e.ParameterObjectAsJson + "\n"); };
        await core.CallDevToolsProtocolMethodAsync("Runtime.enable", "{}");
        // Wait for the app to boot, or for its "couldn't load" screen.
        for (int i = 0; i < 240; i++)
        {
            var state = await core.ExecuteScriptAsync("window.__arcDebug ? 'up' : (document.getElementById('loadMsg')?.textContent || '').startsWith(\"Couldn't\") ? 'failed' : 'wait'");
            if (state != "\"wait\"") { File.AppendAllText(log, "BOOT " + state + "\n"); break; }
            await Task.Delay(500);
        }
        await Task.Delay(2500);
        await Shot("boot");
        if (await core.ExecuteScriptAsync("!!window.__arcDebug") != "true")
        {
            File.AppendAllText(log, "LOADMSG " + await core.ExecuteScriptAsync("document.getElementById('loadMsg')?.textContent") + "\n");
            Close();
            return;
        }
        var seed = Environment.GetEnvironmentVariable("ARC_SELFTEST_SEED");
        if (seed != null)
        {
            // A seed script may set window.__selftestPending and later window.__selftestReport (chaos tests).
            await core.ExecuteScriptAsync(File.ReadAllText(seed));
            await Task.Delay(1500);
            for (int i = 0; i < 360 && await core.ExecuteScriptAsync("!!window.__selftestPending && !window.__selftestReport") == "true"; i++) await Task.Delay(500);
            var report = await core.ExecuteScriptAsync("window.__selftestReport ? JSON.stringify(window.__selftestReport) : ''");
            if (report != "\"\"") File.AppendAllText(log, "REPORT " + report + "\n");
            await Task.Delay(1000);
        }
        foreach (var tab in new[] { "tracked", "find-mushroom", "find-prickly-pear", "find-spring", "craft", "prices", "projects", "insights", "insights-raid", "traders", "hover", "sync" })
        {
            var js = tab == "sync" ? "window.__arcDebug.openSync()"
                : tab == "insights-raid" ? "(()=>{document.querySelector('[data-tab=insights]').click();const h=[...document.querySelectorAll('#view h2')].find(x=>x.textContent.startsWith('Where to raid'));if(h)h.scrollIntoView();})()"
                : tab.StartsWith("find-") ? "(()=>{const S=window.__arcDebug.S;S.findId='" + tab.Substring(5) + "';S.findQ='';document.querySelector('[data-tab=find]').click();window.__arcDebug.render()})()"
                : tab == "hover" ? "document.querySelectorAll('.tile')[3]?.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}))"
                : "document.querySelector('[data-tab=" + tab + "]').click()";
            await core.ExecuteScriptAsync(js);
            await Task.Delay(1500);
            await Shot(tab);
        }
        File.AppendAllText(log, "STATE " + await core.ExecuteScriptAsync("JSON.stringify({inv:Object.keys(window.__arcDebug.S.inv).length,chip:document.getElementById('syncChip').innerText,syncError:window.__arcDebug.SY.error,signedIn:window.__arcDebug.SY.signedIn})") + "\n");
        var mem = Process.GetCurrentProcess();
        File.AppendAllText(log, "HOST_MB " + (mem.WorkingSet64 / 1048576) + "\n");
        Close();
    }

    async Task Shot(string name)
    {
        using (var fs = File.Create(Path.Combine(selfTest, name + ".png")))
            await view.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, fs);
    }
}
