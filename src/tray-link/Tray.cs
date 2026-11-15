// Vaultgate tray: Tray.cs (C#/WinForms). Geladen door windows-tray.ps1 met Add-Type.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Globalization;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

public static class KsTray {
    static StreamWriter writer;
    static readonly object writeLock = new object();
    static readonly JavaScriptSerializer json = new JavaScriptSerializer();
    static readonly Dictionary<string, string> texts = new Dictionary<string, string>();
    static Control ui;
    static NotifyIcon icon;
    static ContextMenuStrip menu;
    static string portalUrl;
    public static string SnapshotDir;

    public static void Send(Dictionary<string, object> msg) {
        lock (writeLock) { try { writer.WriteLine(json.Serialize(msg)); } catch (IOException) { } }
    }

    public static string Text(string key, string fallback) {
        string value;
        return texts.TryGetValue(key, out value) && !string.IsNullOrEmpty(value) ? value : fallback;
    }

    public static string Fill(string template, string key, string value) {
        return template.Replace("{" + key + "}", value);
    }

    static void SetTexts(string textsJson) {
        texts.Clear();
        try {
            var map = json.Deserialize<Dictionary<string, object>>(string.IsNullOrEmpty(textsJson) ? "{}" : textsJson);
            foreach (var pair in map) texts[pair.Key] = pair.Value == null ? "" : pair.Value.ToString();
        } catch {
            // Fallback naar ingebakken Engelse tekst.
        }
    }

    public static int Run(string pipeName, string token, string portal, string snapshotDir, string textsJson) {
        portalUrl = portal;
        SnapshotDir = string.IsNullOrEmpty(snapshotDir) ? null : snapshotDir;
        SetTexts(textsJson);
        Application.EnableVisualStyles();
        // Asynchronous: anders blokkeert de lopende ReadLine op de lees-thread elke WriteLine op dezelfde handle.
        var pipe = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
        pipe.Connect(5000);
        var reader = new StreamReader(pipe, new UTF8Encoding(false));
        writer = new StreamWriter(pipe, new UTF8Encoding(false));
        writer.AutoFlush = true;
        writer.NewLine = "\n";
        Send(new Dictionary<string, object> { { "type", "hello" }, { "token", token } });

        ui = new Control();
        ui.CreateControl();
        var handle = ui.Handle;
        menu = new ContextMenuStrip();
        icon = new NotifyIcon();
        icon.ContextMenuStrip = menu;
        ApplyState(true, new ArrayList());
        icon.Visible = true;
        // Wisselt Windows van licht naar donker (of omgekeerd) terwijl de tray draait: het menu volgt meteen; nieuwe pop-ups ook.
        SystemEvents.UserPreferenceChanged += (s, e) => ui.BeginInvoke((Action)(() => ApplyState(lastLocked, lastPending)));

        var readerThread = new Thread(() => {
            try {
                string line;
                while ((line = reader.ReadLine()) != null) {
                    var msg = json.Deserialize<Dictionary<string, object>>(line);
                    ui.BeginInvoke((Action)(() => Handle(msg)));
                }
            } catch (IOException) { }
            ui.BeginInvoke((Action)(() => Application.ExitThread()));
        });
        readerThread.IsBackground = true;
        readerThread.Start();
        Application.Run();
        icon.Visible = false;
        icon.Dispose();
        return 0;
    }

    static string Field(Dictionary<string, object> m, string key) {
        object v;
        return m.TryGetValue(key, out v) && v != null ? v.ToString() : "";
    }

    static void Handle(Dictionary<string, object> msg) {
        string type = Field(msg, "type");
        if (type == "ask") new Popup(msg).Show();
        // 9.13: een melding (geen vraag), bv. "vertraagd na foute pogingen".
        if (type == "notify") { var n = new Dictionary<string, object>(msg); n["variant"] = "notify"; new Popup(n).Show(); }
        if (type == "state") {
            object pending;
            msg.TryGetValue("pending", out pending);
            ApplyState(Field(msg, "locked") == "True", pending as ArrayList ?? new ArrayList());
        }
    }

    // Icoon: grijs = vergrendeld, groen = ontgrendeld, oranje = er wacht een goedkeuring.
    static Icon MakeIcon(Color fill) {
        var bmp = new Bitmap(16, 16);
        using (var g = Graphics.FromImage(bmp)) {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Color.Transparent);
            using (var b = new SolidBrush(fill)) g.FillEllipse(b, 1, 1, 14, 14);
            using (var p = new Pen(Color.White, 2)) { g.DrawLine(p, 5, 4, 5, 12); g.DrawLine(p, 5, 8, 11, 4); g.DrawLine(p, 5, 8, 11, 12); }
        }
        return Icon.FromHandle(bmp.GetHicon());
    }

    static bool lastLocked = true;
    static ArrayList lastPending = new ArrayList();

    static void ApplyState(bool locked, ArrayList pending) {
        lastLocked = locked;
        lastPending = pending;
        var theme = Theme.Current();
        menu.Renderer = new ToolStripProfessionalRenderer(new ThemeColors(theme));
        menu.BackColor = theme.Base;
        menu.ForeColor = theme.Text;
        int waiting = pending.Count;
        Color fill = locked ? Color.FromArgb(128, 128, 128) : waiting > 0 ? Color.FromArgb(230, 126, 34) : Color.FromArgb(39, 174, 96);
        icon.Icon = MakeIcon(fill);
        string state = locked ? Text("tray.menu.tooltip.locked", "vault closed") : Text("tray.menu.tooltip.unlocked", "vault open");
        string tip = "Vaultgate: " + state;
        if (waiting > 0) tip += " " + Fill(Text("tray.menu.tooltip.pending", "({count} pending)"), "count", waiting.ToString(CultureInfo.InvariantCulture));
        icon.Text = tip.Length > 63 ? tip.Substring(0, 63) : tip;

        menu.Items.Clear();
        var status = new ToolStripMenuItem(locked ? Text("tray.menu.vault.locked", "Vault: closed") : Text("tray.menu.vault.unlocked", "Vault: open"));
        status.Enabled = false;
        menu.Items.Add(status);
        var waitingItem = new ToolStripMenuItem(Fill(Text("tray.menu.pending", "Pending approvals ({count})"), "count", waiting.ToString(CultureInfo.InvariantCulture)));
        foreach (var p in pending) {
            var d = p as Dictionary<string, object>;
            if (d == null) continue;
            var item = new ToolStripMenuItem(Field(d, "tool") + " " + ((char)0x2192).ToString() + " " + Field(d, "secret") + " @ " + Field(d, "host"));
            item.Enabled = false;
            waitingItem.DropDownItems.Add(item);
        }
        waitingItem.Enabled = waiting > 0;
        menu.Items.Add(waitingItem);
        menu.Items.Add(new ToolStripSeparator());
        var lockItem = new ToolStripMenuItem(Text("tray.menu.lockNow", "Lock now"));
        lockItem.Enabled = !locked;
        lockItem.Click += (s, e) => Send(new Dictionary<string, object> { { "type", "lock" } });
        menu.Items.Add(lockItem);
        // Lock now = Lock zoals in het portaal (portaal dicht, tools werken door); Log out sluit de kluis.
        var logoutItem = new ToolStripMenuItem(Text("tray.menu.logout", "Log out (close vault)"));
        logoutItem.Enabled = !locked;
        logoutItem.Click += (s, e) => Send(new Dictionary<string, object> { { "type", "logout" } });
        menu.Items.Add(logoutItem);
        if (!string.IsNullOrEmpty(portalUrl)) {
            var portalItem = new ToolStripMenuItem(Text("tray.menu.openPortal", "Open portal"));
            // Niet de standaardbrowser (extensies, gedeeld profiel); het proxy-proces opent het afgeschermde venster.
            portalItem.Click += (s, e) => Send(new Dictionary<string, object> { { "type", "open-portal" } });
            menu.Items.Add(portalItem);
        }

        if (SnapshotDir != null) {
            var texts = new List<string>();
            foreach (ToolStripItem i in menu.Items) if (!(i is ToolStripSeparator)) texts.Add(i.Text + (i.Enabled ? "" : Text("tray.menu.disabledSuffix", " [disabled]")));
            var snapshotState = new Dictionary<string, object> { { "locked", locked }, { "pending", waiting }, { "tooltip", icon.Text }, { "menu", texts }, { "color", fill.Name }, { "theme", theme.Name } };
            File.WriteAllText(Path.Combine(SnapshotDir, "state-" + (locked ? "locked" : waiting > 0 ? "pending" : "unlocked") + ".json"), json.Serialize(snapshotState));
            SnapshotMenu(locked ? "locked" : waiting > 0 ? "pending" : "unlocked");
        }
    }

    // Het menu even buiten beeld tonen, tekenen, sluiten (alleen in snapshot-modus).
    static void SnapshotMenu(string name) {
        menu.Show(new Point(-3000, -3000));
        var size = menu.Size;
        using (var bmp = new Bitmap(size.Width, size.Height)) {
            menu.DrawToBitmap(bmp, new Rectangle(Point.Empty, size));
            bmp.Save(Path.Combine(SnapshotDir, "tray-menu-" + name + ".png"));
        }
        menu.Close();
    }
}
