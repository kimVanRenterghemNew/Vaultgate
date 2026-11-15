// Vaultgate tray: Popup.cs (C#/WinForms). Geladen door windows-tray.ps1 met Add-Type.
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

public class Popup : Form {
    const int ARM_MS = 1500; // knoppen pas actief na 1,5 s: wie net Enter/Spatie/klikt, keurt niets goed

    readonly string id;
    readonly string variant;
    readonly int timeoutMs;
    readonly DateTime shownAt = DateTime.UtcNow;
    readonly Label countdown = new Label();
    readonly Button deny = new Button(), once = new Button(), allow = new Button(), always = new Button();
    // Hoe lang "Allow" geldt; de antwoorden komen overeen met de beslisregels van de goedkeuring.
    readonly ComboBox span = new ComboBox();
    readonly string[] spanLabels;
    static readonly string[] SpanAnswers = { "30m", "1h", "4h", "always" };
    readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
    readonly Theme theme;
    bool answered;
    bool snapshotDone;
    protected override bool ShowWithoutActivation { get { return true; } } // steelt de focus niet

    static string Field(Dictionary<string, object> m, string key) {
        object v;
        return m.TryGetValue(key, out v) && v != null ? v.ToString() : "";
    }

    // Host altijd als punycode: een host met een Cyrillische a mag niet als apple.com ogen.
    static string AsciiHost(string host) {
        try { return new IdnMapping().GetAscii(host); } catch (ArgumentException) { return KsTray.Text("tray.popup.invalidHost", "(invalid host)"); }
    }

    public Popup(Dictionary<string, object> m) {
        id = Field(m, "id");
        string v = Field(m, "variant");
        variant = v == "tunnel" || v == "device" || v == "subdomain" || v == "notify" ? v : "approve";
        int parsed;
        bool notify = variant == "notify", tunnel = variant == "tunnel", device = variant == "device";
        timeoutMs = int.TryParse(Field(m, "timeoutMs"), NumberStyles.Integer, CultureInfo.InvariantCulture, out parsed) ? parsed : (notify ? 8000 : 30000);
        spanLabels = new string[] { KsTray.Text("tray.popup.span.30m", "30 min"), KsTray.Text("tray.popup.span.1h", "1 hour"), KsTray.Text("tray.popup.span.4h", "4 hours"), KsTray.Text("tray.popup.span.always", "always") };
        Text = notify ? (Field(m, "title") != "" ? Field(m, "title") : "Vaultgate") : tunnel ? KsTray.Text("tray.popup.title.tunnel", "Vaultgate: TUNNEL") : device ? KsTray.Text("tray.popup.title.device", "Vaultgate: pair tool") : KsTray.Text("tray.popup.title.approve", "Vaultgate: approval");
        FormBorderStyle = FormBorderStyle.FixedSingle;
        ControlBox = false; // geen X: sluiten zonder keuze bestaat niet, het is weigeren of de time-out
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        Font = new Font("Segoe UI", 9.5f);
        ClientSize = new Size(520, 256);
        theme = Theme.Current();
        BackColor = theme.Base;
        ForeColor = theme.Text;
        var area = Screen.PrimaryScreen.WorkingArea;
        Location = new Point(area.Right - Width - 12, area.Bottom - Height - 12);

        var header = new Label { Dock = DockStyle.Top, Height = 44, Padding = new Padding(10, 0, 10, 0), TextAlign = ContentAlignment.MiddleLeft, Font = new Font("Segoe UI", 10.5f, FontStyle.Bold) };
        header.BackColor = tunnel ? theme.Error : theme.Primary;
        header.ForeColor = tunnel ? theme.ErrorText : theme.PrimaryText;
        header.Text = notify ? (Field(m, "title") != "" ? Field(m, "title") : "Vaultgate") : tunnel ? ((char)0x26A0).ToString() + " " + KsTray.Text("tray.popup.header.tunnel", "Tunnel without fill-in and without scrubbing: security risk") : device ? KsTray.Text("tray.popup.header.device", "A tool asks for a key: pair?") : variant == "subdomain" ? KsTray.Text("tray.popup.header.subdomain", "A new subdomain: add it to this secret?") : KsTray.Text("tray.popup.header.approve", "New combination: allow?");

        var body = new Label { Location = new Point(12, 54), Size = new Size(496, 120), Font = new Font("Consolas", 9.5f), ForeColor = theme.Text };
        body.Text = notify ? Field(m, "text") : device
            ? KsTray.Text("tray.popup.field.tool", "Tool") + ":    " + Field(m, "tool") + " " + KsTray.Text("tray.popup.new", "(new)") + "\r\n"
                + KsTray.Text("tray.popup.field.client", "Client") + ":  " + Field(m, "client") + "\r\n\r\n"
                + KsTray.Text("tray.popup.typeCode", "Type the code from your terminal into the pairing request in the Vaultgate portal first; only then can you allow it here.")
            : KsTray.Text("tray.popup.field.tool", "Tool") + ":    " + Field(m, "tool") + "\r\n"
                + (tunnel ? "" : KsTray.Text("tray.popup.field.secret", "Secret") + ":  " + Field(m, "secret") + "\r\n")
                + KsTray.Text("tray.popup.field.host", "Host") + ":    " + AsciiHost(Field(m, "host")) + "\r\n"
                + (Field(m, "method") != "" ? KsTray.Text("tray.popup.field.request", "Request") + ": " + Field(m, "method") + " " + Field(m, "path") + "\r\n" : "")
                + KsTray.Text("tray.popup.field.client", "Client") + ":  " + Field(m, "client") + (Field(m, "certRoot") != "" ? "\r\n" + KsTray.Text("tray.popup.root." + Field(m, "certRoot"), "") : "")
                + (tunnel ? "" : Field(m, "sensitive").ToLowerInvariant() == "true" ? "\r\n" + KsTray.Text("tray.popup.sensitive", "Sensitive: touch your passkey after this.") : "\r\n" + KsTray.Text("tray.popup.allowTimed", "\"Allow\" for a time: touch your passkey after this."));

        countdown.Location = new Point(12, 180);
        countdown.Size = new Size(496, 20);
        countdown.ForeColor = theme.Muted;

        Setup(deny, notify ? KsTray.Text("tray.popup.button.dismiss", "OK") : KsTray.Text("tray.popup.button.deny", "Deny"), "deny", notify ? 388 : 12, 120, 0);
        Setup(once, device ? KsTray.Text("tray.popup.button.allow", "Allow") : KsTray.Text("tray.popup.button.once", "Once"), "once", device ? 388 : 140, 120, 1);
        Setup(always, KsTray.Text("tray.popup.button.always", "Always"), "always", 388, 120, 3);
        Setup(allow, KsTray.Text("tray.popup.button.allow", "Allow"), null, 386, 122, 3);
        allow.Click += (s, e) => Answer(SpanAnswers[Math.Max(0, span.SelectedIndex)]);
        span.DropDownStyle = ComboBoxStyle.DropDownList;
        span.FlatStyle = FlatStyle.Flat;
        span.BackColor = theme.Surface;
        span.ForeColor = theme.Text;
        span.Font = new Font("Segoe UI", 11f);
        span.DrawMode = DrawMode.OwnerDrawFixed;
        span.ItemHeight = 24;
        span.DrawItem += (s, e) => {
            if (e.Index < 0) return;
            bool selected = (e.State & DrawItemState.Selected) != 0 && (e.State & DrawItemState.ComboBoxEdit) == 0;
            using (var back = new SolidBrush(selected ? theme.Primary : theme.Surface)) e.Graphics.FillRectangle(back, e.Bounds);
            TextRenderer.DrawText(e.Graphics, spanLabels[e.Index], span.Font, e.Bounds, selected ? theme.PrimaryText : theme.Text, TextFormatFlags.VerticalCenter | TextFormatFlags.Left);
        };
        bool manualKey = Field(m, "manualKey").ToLowerInvariant() == "true";
        span.Items.AddRange(manualKey ? new object[] { spanLabels[0], spanLabels[1], spanLabels[2] } : spanLabels);
        span.SelectedIndex = 0;
        span.Location = new Point(268, 212);
        span.Size = new Size(110, 32);
        span.TabIndex = 2;
        span.Enabled = false;
        CancelButton = deny;
        Controls.AddRange(notify ? new Control[] { header, body, countdown, deny }
            : device ? new Control[] { header, body, countdown, deny, once }
            : tunnel ? new Control[] { header, body, countdown, deny, once, always }
            : new Control[] { header, body, countdown, deny, once, span, allow });

        timer.Interval = 100;
        timer.Tick += (s, e) => Tick();
        Shown += (s, e) => { timer.Start(); Tick(); };
    }

    void Setup(Button b, string label, string answer, int x, int width, int tab) {
        b.FlatStyle = FlatStyle.Flat; b.FlatAppearance.BorderColor = theme.Border; b.FlatAppearance.BorderSize = 1;
        b.BackColor = theme.Surface; b.ForeColor = theme.Text; b.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
        b.Cursor = Cursors.Hand; b.Text = label; b.Location = new Point(x, 210); b.Size = new Size(width, 32);
        b.TabIndex = tab; b.Enabled = false;
        if (answer != null) b.Click += (s, e) => Answer(answer);
    }

    int Elapsed() { return (int)(DateTime.UtcNow - shownAt).TotalMilliseconds; }

    void Tick() {
        int left = timeoutMs - Elapsed();
        bool armed = Elapsed() >= ARM_MS;
        if (!answered && armed && !deny.Enabled) {
            deny.Enabled = once.Enabled = allow.Enabled = always.Enabled = span.Enabled = true;
            if (Form.ActiveForm == this) deny.Select();
        }
        if (!answered && left <= 0) { Answer("timeout"); return; }
        if (!answered) {
            string text = KsTray.Fill(KsTray.Text("tray.popup.countdown", "expires in {seconds} s"), "seconds", Math.Ceiling(left / 1000.0).ToString(CultureInfo.InvariantCulture));
            countdown.Text = (armed ? "" : KsTray.Text("tray.popup.arming", "(buttons active after 1.5 s)  ")) + text;
        }
        if (KsTray.SnapshotDir != null && armed && !snapshotDone) {
            snapshotDone = true;
            using (var bmp = new Bitmap(Width, Height)) {
                DrawToBitmap(bmp, new Rectangle(0, 0, Width, Height));
                bmp.Save(Path.Combine(KsTray.SnapshotDir, "popup-" + variant + ".png"));
            }
        }
    }

    void Answer(string answer) {
        if (answered) return;
        answered = true;
        if (!string.IsNullOrEmpty(id)) KsTray.Send(new Dictionary<string, object> { { "type", "answer" }, { "id", id }, { "answer", answer } });
        deny.Enabled = once.Enabled = allow.Enabled = always.Enabled = span.Enabled = false;
        if (answer == "timeout" && !string.IsNullOrEmpty(id)) {
            countdown.Text = KsTray.Text("tray.popup.timedOut", "expired: nothing allowed");
            countdown.ForeColor = theme.Error;
            var close = new System.Windows.Forms.Timer();
            close.Interval = 1500;
            close.Tick += (s, e) => { close.Stop(); Close(); };
            close.Start();
        } else {
            Close();
        }
    }

    protected override void OnFormClosed(FormClosedEventArgs e) { timer.Stop(); base.OnFormClosed(e); }
}
