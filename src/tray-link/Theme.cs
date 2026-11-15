// Vaultgate tray: Theme.cs (C#/WinForms). Geladen door windows-tray.ps1 met Add-Type.
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

// Dezelfde kleuren als het portaal (daisyUI). Windows in dark mode: dim; in light mode: nord.
// KS_TRAY_THEME=dark|light dwingt een thema af (alleen voor de probe en de screenshots).
public class Theme {
    public string Name;
    public Color Base, Surface, Text, Muted, Primary, PrimaryText, Secondary, SecondaryText, Error, ErrorText, Border;

    public static Theme Current() {
        string forced = Environment.GetEnvironmentVariable("KS_TRAY_THEME");
        bool light;
        if (forced == "light") light = true;
        else if (forced == "dark") light = false;
        else {
            object v = Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "AppsUseLightTheme", 1);
            light = !(v is int) || (int)v != 0;
        }
        return light ? Nord() : Dim();
    }

    static Color Hex(string h) { return ColorTranslator.FromHtml(h); }

    // Dezelfde kleuren als het portaal: daisyUI dim (donker) en nord (licht), omgerekend van oklch naar RGB.
    public static Theme Dim() {
        var t = new Theme();
        t.Name = "dim";
        t.Base = Hex("#2a303c"); t.Surface = Hex("#242933"); t.Text = Hex("#b2ccd6"); t.Muted = Hex("#8193a0"); t.Border = Hex("#3a4250");
        t.Primary = Hex("#9fe88d"); t.PrimaryText = Hex("#091307");
        t.Secondary = Hex("#c792e9"); t.SecondaryText = Hex("#0e0813");
        t.Error = Hex("#ffae9b"); t.ErrorText = Hex("#160b09");
        return t;
    }

    public static Theme Nord() {
        var t = new Theme();
        t.Name = "nord";
        t.Base = Hex("#eceff4"); t.Surface = Hex("#e5e9f0"); t.Text = Hex("#2e3440"); t.Muted = Hex("#4c566a"); t.Border = Hex("#d8dee9");
        t.Primary = Hex("#5e81ac"); t.PrimaryText = Hex("#03060b");
        t.Secondary = Hex("#81a1c1"); t.SecondaryText = Hex("#06090d");
        t.Error = Hex("#bf616a"); t.ErrorText = Hex("#0d0304");
        return t;
    }
}

// Kleuren van het tray-menu volgens het thema.
public class ThemeColors : ProfessionalColorTable {
    readonly Theme t;
    public ThemeColors(Theme theme) { t = theme; }
    public override Color ToolStripDropDownBackground { get { return t.Base; } }
    public override Color ImageMarginGradientBegin { get { return t.Base; } }
    public override Color ImageMarginGradientMiddle { get { return t.Base; } }
    public override Color ImageMarginGradientEnd { get { return t.Base; } }
    public override Color MenuBorder { get { return t.Border; } }
    public override Color MenuItemBorder { get { return t.Secondary; } }
    public override Color MenuItemSelected { get { return t.Surface; } }
    public override Color MenuItemSelectedGradientBegin { get { return t.Surface; } }
    public override Color MenuItemSelectedGradientEnd { get { return t.Surface; } }
    public override Color SeparatorDark { get { return t.Border; } }
    public override Color SeparatorLight { get { return t.Border; } }
}
