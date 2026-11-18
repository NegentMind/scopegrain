from pathlib import Path
from functools import lru_cache
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent
FONTS = Path(r"C:\Users\Eros\.copilot\skills\canvas-design\canvas-fonts")
FONT_FILES = {
    "display": "BricolageGrotesque-Regular.ttf",
    "display_bold": "BricolageGrotesque-Bold.ttf",
    "body": "InstrumentSans-Regular.ttf",
    "body_bold": "InstrumentSans-Bold.ttf",
    "mono": "DMMono-Regular.ttf",
}
S = 2
PAPER = "#F6F7F3"
INK = "#1A2923"
CLAY = "#BF4F2B"
GREEN = "#34644B"
RULE = "#D8DED6"
LINK = "#425C70"
MUTED = "#55675E"
SIDE = "#EEF1EB"
SELECTED = "#E9EFE8"
TINT = "#F0E6DF"
WHITE = "#FAFBF8"


@lru_cache(None)
def font(kind, size):
    return ImageFont.truetype(str(FONTS / FONT_FILES[kind]), round(size * S))


def xy(v):
    return round(v * S)


def box(values):
    return tuple(xy(v) for v in values)


def text(d, x, y, value, kind="body", size=14, fill=INK):
    d.text((xy(x), xy(y)), value, font=font(kind, size), fill=fill, anchor="lt")


def right(d, x, y, value, kind="body", size=14, fill=INK):
    width = d.textlength(value, font=font(kind, size)) / S
    text(d, x - width, y, value, kind, size, fill)


def line(d, points, fill=RULE, width=1):
    d.line([(xy(x), xy(y)) for x, y in points], fill=fill, width=xy(width))


def rect(d, x0, y0, x1, y1, fill=None, outline=None, width=1):
    d.rectangle(box((x0, y0, x1, y1)), fill=fill, outline=outline,
                width=xy(width))


def roundrect(d, x0, y0, x1, y1, radius=5, fill=None, outline=None):
    d.rounded_rectangle(box((x0, y0, x1, y1)), radius=xy(radius),
                        fill=fill, outline=outline, width=xy(1))


def ellipse(d, x0, y0, x1, y1, fill=None, outline=None, width=1):
    d.ellipse(box((x0, y0, x1, y1)), fill=fill, outline=outline, width=xy(width))


def mark(d, x, y, size, ink=INK, accent=CLAY, grid=False):
    def p(a, b):
        return x + size * a, y + size * b

    if grid:
        for i in range(1, 8):
            v = .08 + i * .105
            line(d, [p(.08, v), p(.92, v)], "#E7EBE4", .6)
            line(d, [p(v, .08), p(v, .92)], "#E7EBE4", .6)
    w = max(1.2, size * .025)
    line(d, [p(.08, .41), p(.08, .08), p(.41, .08)], ink, w)
    line(d, [p(.59, .92), p(.92, .92), p(.92, .59)], ink, w)
    for a, b, side, color in [
        (.16, .60, .23, ink),
        (.45, .48, .15, ink),
        (.62, .34, .15, ink),
        (.69, .15, .075, accent),
        (.79, .15, .075, ink),
        (.69, .25, .075, ink),
        (.79, .25, .075, ink),
    ]:
        rect(d, x + size * a, y + size * b,
             x + size * (a + side), y + size * (b + side), fill=color)


def canvas(w, h, background=PAPER):
    img = Image.new("RGBA", (w * S, h * S), background)
    return img, ImageDraw.Draw(img)


def save(img, name, transparent=False):
    result = img.resize((img.width // S, img.height // S),
                        Image.Resampling.LANCZOS)
    if not transparent:
        result = result.convert("RGB")
    result.save(OUT / name, "PNG", optimize=True)


def search_icon(d, x, y):
    ellipse(d, x, y, x + 9, y + 9, outline=MUTED, width=1)
    line(d, [(x + 8, y + 8), (x + 12, y + 12)], MUTED, 1)


def menu_icon(d, x, y):
    for off in (0, 5, 10):
        line(d, [(x, y + off), (x + 16, y + off)], INK, 1.2)


def chevron(d, x, y, color=MUTED):
    line(d, [(x, y), (x + 4, y + 4), (x + 8, y)], color, 1.1)


def banner():
    img, d = canvas(1600, 560)
    rect(d, 0, 0, 12, 560, fill=INK)
    mark(d, 118, 91, 356, grid=True)
    line(d, [(537, 112), (537, 444)], RULE)
    text(d, 594, 127, "Scopegrain", "display_bold", 91)
    text(d, 598, 262, "Proportional engineering for coding agents.",
         "body", 26, INK)
    line(d, [(598, 348), (1440, 348)], RULE)
    text(d, 598, 387, "Context / Decisions / Evidence", "mono", 17, MUTED)
    save(img, "scopegrain-banner.png")


def symbol():
    img, d = canvas(512, 512, (0, 0, 0, 0))
    mark(d, 30, 30, 452)
    save(img, "scopegrain-mark.png", transparent=True)


ROWS = [
    ("SG-101", "Workspace onboarding", "Core", "PLAN"),
    ("SG-102", "VantaDB namespace isolation", "Memory", "RESEARCH"),
    ("SG-103", "Native host skills", "Integrations", "ACT"),
    ("SG-104", "Sync queue recovery", "Memory", "VERIFY"),
    ("SG-105", "Installation receipts", "Lifecycle", "REVIEW"),
    ("SG-106", "Bilingual user guide", "Docs", "ACCEPT"),
]
CHAIN = ["Specification", "Design", "Task", "Verification", "Review"]


def sidebar(d):
    rect(d, 0, 0, 223, 1000, fill=SIDE)
    line(d, [(223, 0), (223, 1000)], RULE)
    mark(d, 23, 22, 30)
    text(d, 64, 28, "Scopegrain", "display_bold", 18)
    line(d, [(24, 79), (199, 79)], RULE)
    text(d, 24, 109, "WORK", "mono", 10, MUTED)
    nav = [("Backlog", 142), ("Tasks", 181), ("Plans", 220),
           ("Progress", 259)]
    for label, y in nav:
        if label == "Tasks":
            roundrect(d, 16, y - 8, 207, y + 25, 5, "#DEE8DD")
            ellipse(d, 27, y + 3, 32, y + 8, fill=CLAY)
        else:
            ellipse(d, 27, y + 3, 32, y + 8, outline="#89998C", width=1)
        text(d, 44, y, label, "body_bold" if label == "Tasks" else "body",
             14, INK)
    text(d, 24, 316, "KNOWLEDGE", "mono", 10, MUTED)
    for label, y in [("Research", 349), ("Decisions", 388),
                     ("Designs", 427), ("Memory", 466)]:
        text(d, 44, y, label, "body", 14)
    text(d, 24, 523, "ASSURANCE", "mono", 10, MUTED)
    for label, y in [("Verifications", 556), ("Reviews", 595),
                     ("Reports", 634), ("Results", 673)]:
        text(d, 44, y, label, "body", 14)
    line(d, [(24, 912), (199, 912)], RULE)
    text(d, 24, 936, "DESIGN PREVIEW", "mono", 10, MUTED)
    text(d, 24, 956, "Sample data only", "body", 12, MUTED)


def desktop():
    img, d = canvas(1440, 1000)
    sidebar(d)
    line(d, [(224, 75), (1440, 75)], RULE)
    text(d, 260, 29, "Sample workspace", "body_bold", 14)
    chevron(d, 405, 35)
    line(d, [(436, 22), (436, 54)], RULE)
    text(d, 458, 29, "All areas", "body", 14, MUTED)
    chevron(d, 529, 35)
    right(d, 1400, 29, "DESIGN PREVIEW / SAMPLE DATA", "mono", 11, MUTED)
    line(d, [(1102, 75), (1102, 1000)], RULE)

    text(d, 260, 129, "Project ledger", "display_bold", 37)
    text(d, 261, 185, "Work records and their evidence", "body", 15, MUTED)
    line(d, [(260, 220), (1068, 220)], RULE)
    roundrect(d, 260, 253, 748, 299, 5, WHITE, RULE)
    search_icon(d, 277, 269)
    text(d, 300, 268, "Search records", "body", 14, MUTED)
    roundrect(d, 762, 253, 922, 299, 5, WHITE, RULE)
    text(d, 779, 268, "All areas", "body", 14)
    chevron(d, 894, 271)
    text(d, 260, 338, "KEY", "mono", 10, MUTED)
    text(d, 386, 338, "WORK", "mono", 10, MUTED)
    text(d, 820, 338, "AREA", "mono", 10, MUTED)
    text(d, 958, 338, "STATE", "mono", 10, MUTED)
    line(d, [(260, 361), (1068, 361)], INK, 1)
    for i, (key, title, area, state) in enumerate(ROWS):
        y = 362 + i * 67
        if key == "SG-104":
            rect(d, 260, y + 1, 1068, y + 66, fill=SELECTED)
            ellipse(d, 269, y + 29, 275, y + 35, fill=CLAY)
        text(d, 286 if key == "SG-104" else 260, y + 24, key, "mono", 12,
             CLAY if key == "SG-104" else MUTED)
        text(d, 386, y + 23, title, "body_bold" if key == "SG-104" else "body", 15)
        text(d, 820, y + 24, area, "body", 13, MUTED)
        text(d, 958, y + 24, state, "mono", 11,
             GREEN if state in ("ACT", "ACCEPT") else INK)
        line(d, [(260, y + 66), (1068, y + 66)], RULE)
    text(d, 260, 810, "Selected record", "body", 12, MUTED)
    text(d, 260, 836, "SG-104  /  Sync queue recovery", "mono", 12, INK)
    text(d, 260, 886, "Connections are examples, not verification results.",
         "body", 12, MUTED)

    text(d, 1132, 119, "Evidence chain", "display_bold", 22)
    text(d, 1132, 156, "SG-104", "mono", 11, CLAY)
    text(d, 1132, 181, "Sync queue recovery", "body_bold", 15)
    line(d, [(1132, 214), (1409, 214)], RULE)
    line(d, [(1140, 247), (1140, 509)], "#BCC9BB", 1)
    for i, stage in enumerate(CHAIN):
        y = 240 + i * 65
        ellipse(d, 1135, y + 3, 1145, y + 13, fill=PAPER,
                outline=CLAY if stage == "Task" else GREEN, width=1)
        text(d, 1160, y, stage, "body_bold" if stage == "Task" else "body", 14)
        text(d, 1160, y + 22, "Example", "body", 11, MUTED)
    line(d, [(1132, 592), (1409, 592)], RULE)
    text(d, 1132, 621, "Memory & queue", "display_bold", 18)
    roundrect(d, 1132, 662, 1409, 824, 6, WHITE, RULE)
    ellipse(d, 1150, 682, 1158, 690, fill=CLAY)
    text(d, 1168, 680, "VantaDB: offline (sample)", "body_bold", 13)
    text(d, 1150, 718, "Local records remain available.", "body", 13)
    text(d, 1150, 741, "Synchronization is queued.", "body", 13)
    text(d, 1150, 785, "SAMPLE DATA", "mono", 10, MUTED)
    save(img, "dashboard-desktop.png")


def mobile():
    img, d = canvas(390, 844)
    mark(d, 18, 11, 30)
    text(d, 55, 19, "Scopegrain", "display_bold", 17)
    menu_icon(d, 352, 21)
    line(d, [(0, 51), (390, 51)], RULE)
    text(d, 20, 62, "DESIGN PREVIEW / SAMPLE DATA", "mono", 10, MUTED)
    line(d, [(20, 83), (370, 83)], RULE)
    text(d, 20, 96, "Sample workspace", "body_bold", 13)
    chevron(d, 159, 100)
    line(d, [(190, 93), (190, 114)], RULE)
    text(d, 207, 96, "All areas", "body", 13, MUTED)
    chevron(d, 270, 100)
    text(d, 20, 133, "Project ledger", "display_bold", 25)
    roundrect(d, 20, 174, 370, 210, 4, WHITE, RULE)
    search_icon(d, 32, 186)
    text(d, 53, 185, "Search records", "body", 13, MUTED)
    text(d, 20, 225, "WORK", "mono", 10, MUTED)
    right(d, 370, 225, "AREA / STATE", "mono", 10, MUTED)
    line(d, [(20, 244), (370, 244)], INK, 1)
    for i, (key, title, area, state) in enumerate(ROWS):
        y = 245 + i * 47
        if key == "SG-104":
            rect(d, 20, y + 1, 370, y + 46, fill=SELECTED)
        text(d, 26, y + 6, title, "body_bold" if key == "SG-104" else "body",
             13)
        text(d, 26, y + 26, key, "mono", 10,
             CLAY if key == "SG-104" else MUTED)
        right(d, 363, y + 26, f"{area} / {state}", "mono", 10, MUTED)
        line(d, [(20, y + 46), (370, y + 46)], RULE)
    text(d, 20, 545, "SG-104", "mono", 11, CLAY)
    text(d, 100, 544, "Sync queue recovery", "body_bold", 14)
    text(d, 20, 574, "Evidence chain", "display_bold", 16)
    right(d, 370, 578, "EXAMPLE", "mono", 10, MUTED)
    line(d, [(45, 610), (343, 610)], "#BBC9BB", 1)
    for x, label in [(20, "Specification"), (100, "Design"), (161, "Task"),
                     (216, "Verification"), (333, "Review")]:
        width = d.textlength(label, font=font("body", 10)) / S
        center = x + width / 2
        ellipse(d, center - 4, 606, center + 4, 614, fill=PAPER,
                outline=CLAY if label == "Task" else GREEN, width=1)
        text(d, x, 625, label, "body", 10, INK)
    line(d, [(20, 661), (370, 661)], RULE)
    text(d, 20, 678, "Memory & queue", "display_bold", 15)
    ellipse(d, 21, 708, 29, 716, fill=CLAY)
    text(d, 38, 706, "VantaDB: offline (sample)", "body_bold", 13)
    text(d, 20, 732, "Local records remain available.", "body", 13)
    text(d, 20, 754, "Synchronization is queued.", "body", 13)
    line(d, [(20, 795), (370, 795)], RULE)
    text(d, 20, 809, "DESIGN PREVIEW / SAMPLE DATA", "mono", 10, MUTED)
    save(img, "dashboard-mobile.png")


if __name__ == "__main__":
    banner()
    symbol()
    desktop()
    mobile()
    for kind, filename in FONT_FILES.items():
        print(kind, FONTS / filename, font(kind, 16).getname())
    print("Rendered four private PNGs to", OUT)
