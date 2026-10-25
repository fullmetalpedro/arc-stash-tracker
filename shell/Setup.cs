// ARC Stash Tracker setup: one exe that carries the whole app (an embedded zip) and installs it for the
// current user, no admin rights needed. Built by shell\build.ps1 (C# 5, .NET Framework 4.8).
//   ArcStashTracker-Setup.exe        interactive
//   ArcStashTracker-Setup.exe /S     silent install (no window, no launch)
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text.RegularExpressions;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;

static class Setup
{
    public const string Name = "ARC Stash Tracker";
    public const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\ArcStashTracker";
    public static readonly string Version = Regex.Replace(FileVersionInfo.GetVersionInfo(Assembly.GetExecutingAssembly().Location).ProductVersion, @"\.0$", "");
    public static readonly string Dest = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", Name);
    public static string Exe { get { return Path.Combine(Dest, "ArcStash.exe"); } }

    [STAThread]
    static int Main(string[] args)
    {
        if (Array.Exists(args, a => a.Equals("/S", StringComparison.OrdinalIgnoreCase)))
        {
            try { Install(true, null); return 0; }
            catch (Exception e) { File.WriteAllText(Path.Combine(Path.GetTempPath(), "ArcStashTracker-setup.log"), e.ToString()); return 1; }
        }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new SetupForm());
        return 0;
    }

    public static void Install(bool desktopShortcut, Action<string> progress)
    {
        if (progress == null) progress = s => { };
        progress("Closing ARC Stash Tracker if it's running...");
        foreach (var p in Process.GetProcessesByName("ArcStash"))
        {
            try
            {
                if (p.MainModule.FileName.StartsWith(Dest, StringComparison.OrdinalIgnoreCase)) { p.Kill(); p.WaitForExit(5000); }
            }
            catch { /* another user's process or already gone */ }
        }

        progress("Copying files...");
        var staging = Dest + ".new";
        if (Directory.Exists(staging)) Directory.Delete(staging, true);
        Directory.CreateDirectory(staging);
        var root = Path.GetFullPath(staging) + Path.DirectorySeparatorChar;
        using (var payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
        using (var zip = new ZipArchive(payload, ZipArchiveMode.Read))
        {
            foreach (var entry in zip.Entries)
            {
                var target = Path.GetFullPath(Path.Combine(staging, entry.FullName));
                if (!target.StartsWith(root, StringComparison.OrdinalIgnoreCase)) throw new Exception("Bad path in package: " + entry.FullName);
                if (entry.FullName.EndsWith("/")) { Directory.CreateDirectory(target); continue; }
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                using (var src = entry.Open())
                using (var dst = File.Create(target)) src.CopyTo(dst);
            }
        }
        // Swap the new files in. The app keeps its data elsewhere (%APPDATA% and %LOCALAPPDATA%\ARC Stash Tracker).
        for (int i = 0; Directory.Exists(Dest); i++)
        {
            try { Directory.Delete(Dest, true); }
            catch { if (i > 20) throw; System.Threading.Thread.Sleep(250); }
        }
        Directory.Move(staging, Dest);

        progress("Creating shortcuts...");
        var startMenu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), Name + ".lnk");
        var desktop = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), Name + ".lnk");
        Shortcut(startMenu);
        if (desktopShortcut) Shortcut(desktop);

        long bytes = 0;
        foreach (var f in Directory.GetFiles(Dest, "*", SearchOption.AllDirectories)) bytes += new FileInfo(f).Length;
        using (var k = Registry.CurrentUser.CreateSubKey(UninstallKey))
        {
            k.SetValue("DisplayName", Name);
            k.SetValue("DisplayVersion", Version);
            k.SetValue("Publisher", Name);
            k.SetValue("DisplayIcon", Exe);
            k.SetValue("InstallLocation", Dest);
            k.SetValue("UninstallString", "\"" + Exe + "\" --uninstall");
            k.SetValue("QuietUninstallString", "\"" + Exe + "\" --uninstall /S");
            k.SetValue("URLInfoAbout", "https://github.com/fullmetalpedro/arc-stash-tracker");
            k.SetValue("EstimatedSize", (int)(bytes / 1024), RegistryValueKind.DWord);
            k.SetValue("NoModify", 1, RegistryValueKind.DWord);
            k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
        }
        progress("Done.");
    }

    static void Shortcut(string lnk)
    {
        var shellType = Type.GetTypeFromProgID("WScript.Shell");
        object shell = Activator.CreateInstance(shellType);
        try
        {
            object sc = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { lnk });
            var t = sc.GetType();
            t.InvokeMember("TargetPath", BindingFlags.SetProperty, null, sc, new object[] { Exe });
            t.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, sc, new object[] { Dest });
            t.InvokeMember("IconLocation", BindingFlags.SetProperty, null, sc, new object[] { Exe + ",0" });
            t.InvokeMember("Description", BindingFlags.SetProperty, null, sc, new object[] { "Stash, crafting and price tracker for ARC Raiders" });
            t.InvokeMember("Save", BindingFlags.InvokeMethod, null, sc, null);
            Marshal.ReleaseComObject(sc);
        }
        finally { Marshal.ReleaseComObject(shell); }
    }

    // The Evergreen WebView2 runtime registers itself under EdgeUpdate (machine-wide or per user).
    public static bool HasWebView2()
    {
        const string id = @"\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
        foreach (var path in new[] { @"HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node" + id, @"HKEY_LOCAL_MACHINE\SOFTWARE" + id, @"HKEY_CURRENT_USER\Software" + id })
        {
            var v = Registry.GetValue(path, "pv", null) as string;
            if (!string.IsNullOrEmpty(v) && v != "0.0.0.0") return true;
        }
        return false;
    }
}

class SetupForm : Form
{
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

    static readonly Color Bg = Color.FromArgb(11, 14, 21), Panel = Color.FromArgb(21, 26, 39), Cream = Color.FromArgb(236, 226, 208),
        Muted = Color.FromArgb(139, 145, 157), Gold = Color.FromArgb(249, 194, 26), Bad = Color.FromArgb(239, 81, 70);
    readonly CheckBox desktop = new CheckBox();
    readonly Button action = new Button();
    readonly Label status = new Label();
    bool installed;

    public SetupForm()
    {
        Text = Setup.Name + " Setup";
        BackColor = Bg; ForeColor = Cream;
        FormBorderStyle = FormBorderStyle.FixedSingle; MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.Dpi; AutoScaleDimensions = new SizeF(96, 96);
        ClientSize = new Size(540, 330);
        Font = new Font("Segoe UI", 10f);
        try { Icon = Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location); } catch { }

        Controls.Add(new StripePanel { Location = new Point(0, 0), Size = new Size(540, 6) });
        Controls.Add(new Label { Text = "ARC STASH TRACKER", Font = new Font("Segoe UI", 18f, FontStyle.Bold), AutoSize = true, Location = new Point(26, 24) });
        Controls.Add(new Label { Text = "Version " + Setup.Version, ForeColor = Muted, AutoSize = true, Location = new Point(29, 62) });
        Controls.Add(new Label
        {
            Text = "Installs for " + Environment.UserName + " in\r\n" + Setup.Dest + "\r\nNo admin rights needed. Updating keeps your data and MetaForge sign-in.",
            ForeColor = Cream, Location = new Point(29, 96), Size = new Size(490, 92)
        });
        desktop.Text = "Create a desktop shortcut"; desktop.Checked = true; desktop.AutoSize = true;
        desktop.Location = new Point(29, 196); desktop.ForeColor = Cream;
        Controls.Add(desktop);

        status.Location = new Point(29, 228); status.Size = new Size(300, 60); status.ForeColor = Muted;
        if (!Setup.HasWebView2())
        {
            status.ForeColor = Bad;
            status.Text = "Microsoft Edge WebView2 Runtime wasn't found. Install it from Microsoft first (link opens in your browser), then run this setup.";
            status.Cursor = Cursors.Hand;
            status.Click += (s, e) => Process.Start(new ProcessStartInfo("https://go.microsoft.com/fwlink/p/?LinkId=2124703") { UseShellExecute = true });
        }
        Controls.Add(status);

        action.Text = "INSTALL"; action.Font = new Font("Segoe UI", 10f, FontStyle.Bold);
        action.BackColor = Gold; action.ForeColor = Color.FromArgb(27, 22, 6);
        action.FlatStyle = FlatStyle.Flat; action.FlatAppearance.BorderSize = 0;
        action.Size = new Size(170, 38); action.Location = new Point(540 - 26 - 170, 330 - 26 - 38);
        action.Click += OnAction;
        Controls.Add(action);
        AcceptButton = action;

        // Self-test hook: ARC_SETUP_SCREENSHOT=<png> draws the window to a file and closes.
        var shot = Environment.GetEnvironmentVariable("ARC_SETUP_SCREENSHOT");
        if (shot != null) Shown += (s, e) => { using (var b = new Bitmap(Width, Height)) { DrawToBitmap(b, new Rectangle(0, 0, Width, Height)); b.Save(shot); } Close(); };
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        int dark = 1;
        DwmSetWindowAttribute(Handle, 20, ref dark, 4);
    }

    async void OnAction(object sender, EventArgs e)
    {
        if (installed)
        {
            Process.Start(new ProcessStartInfo(Setup.Exe) { UseShellExecute = true, WorkingDirectory = Setup.Dest });
            Close();
            return;
        }
        action.Enabled = false; desktop.Enabled = false; status.ForeColor = Muted;
        var wantDesktop = desktop.Checked;
        try
        {
            await Task.Run(() => Setup.Install(wantDesktop, msg => BeginInvoke((Action)(() => status.Text = msg))));
            installed = true;
            status.ForeColor = Cream;
            status.Text = "Installed. You'll find it in the Start menu" + (wantDesktop ? " and on your desktop." : ".");
            action.Text = "OPEN APP";
        }
        catch (Exception ex)
        {
            status.ForeColor = Bad;
            status.Text = "Install failed: " + ex.Message;
        }
        action.Enabled = true;
    }
}

// The four-stripe mark across the top of the window.
class StripePanel : Control
{
    protected override void OnPaint(PaintEventArgs e)
    {
        var colors = new[] { Color.FromArgb(229, 55, 45), Color.FromArgb(249, 194, 26), Color.FromArgb(60, 207, 110), Color.FromArgb(31, 179, 230) };
        int w = Width / colors.Length;
        for (int i = 0; i < colors.Length; i++)
            using (var b = new SolidBrush(colors[i])) e.Graphics.FillRectangle(b, i * w, 0, i == colors.Length - 1 ? Width - i * w : w, Height);
    }
}
