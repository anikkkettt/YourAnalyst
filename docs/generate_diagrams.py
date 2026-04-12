"""
YourAnalyst -- Diagram Generator
Generates three PNG architecture/flow diagrams and saves them to docs/images/
Run: python docs/generate_diagrams.py
"""
# -*- coding: utf-8 -*-
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

import os
import matplotlib
matplotlib.use("Agg")
import matplotlib as mpl
# Use a font that supports common unicode; fall back gracefully
mpl.rcParams["axes.unicode_minus"] = False
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import FancyBboxPatch
import matplotlib.patheffects as pe

OUT_DIR = os.path.join(os.path.dirname(__file__), "images")
os.makedirs(OUT_DIR, exist_ok=True)

# ── Colour palette (matches the app's dark/gold theme) ─────────────────────
BG          = "#0D0D14"
GOLD        = "#F0B429"
GOLD_DIM    = "#B07D0E"
WHITE       = "#F0F0F8"
GREY        = "#4A4A62"
GREY_LIGHT  = "#7A7A9A"

C_FRONT     = "#2563EB"   # blue   – frontend
C_API       = "#7C3AED"   # purple – API layer
C_PIPE      = "#EA580C"   # orange – pipeline
C_SVC       = "#059669"   # green  – services
C_DATA      = "#0891B2"   # teal   – data layer
C_EXT       = "#64748B"   # slate  – external
C_SEMANTIC  = "#6366F1"   # indigo – semantic agent
C_AUDIT     = "#D97706"   # amber  – audit/critic
C_CODER     = "#16A34A"   # green  – coder
C_CRITIC    = "#D97706"   # amber  – critic (same as audit)
C_NARRATOR  = "#DB2777"   # pink   – narrator
C_TRUST     = "#D97706"   # amber  – trust
C_VIZ       = "#0284C7"   # sky    – viz
C_FOLLOWUP  = "#9333EA"   # purple – followup
C_EXECUTOR  = "#B45309"   # brown  – executor
C_SELFCORR  = "#DC2626"   # red    – self-correct
C_START_END = "#374151"   # dark grey – start/end nodes

# ── Shared helpers ──────────────────────────────────────────────────────────

def fig_dark(w, h, dpi=150):
    fig, ax = plt.subplots(figsize=(w, h), dpi=dpi)
    fig.patch.set_facecolor(BG)
    ax.set_facecolor(BG)
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")
    return fig, ax


def rbox(ax, cx, cy, w, h, label, color, text_color=WHITE,
         fontsize=9, radius=0.015, alpha=0.92, sublabel=None,
         sublabel_color=None, bold=False):
    """Draw a rounded rectangle centred at (cx, cy)."""
    x0, y0 = cx - w / 2, cy - h / 2
    box = FancyBboxPatch(
        (x0, y0), w, h,
        boxstyle=f"round,pad=0,rounding_size={radius}",
        linewidth=1.4,
        edgecolor=color,
        facecolor=color + "28",   # 16 % opacity fill
        zorder=3,
    )
    ax.add_patch(box)
    weight = "bold" if bold else "normal"
    if sublabel:
        ax.text(cx, cy + h * 0.14, label,
                ha="center", va="center",
                color=text_color, fontsize=fontsize,
                fontweight=weight, zorder=4,
                linespacing=1.3)
        sl_color = sublabel_color or GREY_LIGHT
        ax.text(cx, cy - h * 0.22, sublabel,
                ha="center", va="center",
                color=sl_color, fontsize=fontsize - 1.5,
                fontstyle="italic", zorder=4)
    else:
        ax.text(cx, cy, label,
                ha="center", va="center",
                color=text_color, fontsize=fontsize,
                fontweight=weight, zorder=4,
                linespacing=1.3)
    return box


def arrow(ax, x1, y1, x2, y2, color=GREY_LIGHT, lw=1.2,
          label=None, label_color=None, connectionstyle="arc3,rad=0.0",
          style="->", zorder=2):
    ax.annotate(
        "", xy=(x2, y2), xytext=(x1, y1),
        arrowprops=dict(
            arrowstyle=style,
            color=color,
            lw=lw,
            connectionstyle=connectionstyle,
        ),
        zorder=zorder,
    )
    if label:
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        lc = label_color or GREY_LIGHT
        ax.text(mx, my, label, ha="center", va="center",
                color=lc, fontsize=7.5,
                bbox=dict(facecolor=BG, edgecolor="none", pad=1.5),
                zorder=5)


def section_label(ax, cx, cy, text, color):
    ax.text(cx, cy, text, ha="center", va="center",
            color=color, fontsize=8, fontweight="bold",
            fontstyle="italic", zorder=5)


def title_text(ax, text, sub=None):
    ax.text(0.5, 0.97, text,
            ha="center", va="top", color=GOLD,
            fontsize=14, fontweight="bold", zorder=6,
            transform=ax.transAxes)
    if sub:
        ax.text(0.5, 0.938, sub,
                ha="center", va="top", color=GREY_LIGHT,
                fontsize=9, zorder=6,
                transform=ax.transAxes)


def divider(ax, y, alpha=0.18):
    ax.axhline(y, color=GOLD, lw=0.6, alpha=alpha, zorder=1)


# ═══════════════════════════════════════════════════════════════════════════
# DIAGRAM 1 — USER JOURNEY FLOWCHART
# ═══════════════════════════════════════════════════════════════════════════

def draw_user_journey():
    fig, ax = fig_dark(14, 20, dpi=150)
    title_text(ax, "YourAnalyst — User Journey", "End-to-end user workflow from landing to insights")

    # Column centres
    CX  = 0.50   # main path
    CXL = 0.18   # left branch
    CXR = 0.82   # right branch

    W_MAIN = 0.28
    W_SIDE = 0.22
    H      = 0.042
    H_S    = 0.036

    def node(cx, cy, label, color, sub=None, w=W_MAIN, bold=False):
        rbox(ax, cx, cy, w, H, label, color, fontsize=9,
             sublabel=sub, bold=bold)

    def dn(cx, cy, label, color=GOLD, w=W_MAIN):
        """Diamond decision node."""
        dx, dy = w / 2, H * 0.7
        pts = [(cx, cy + dy), (cx + dx, cy), (cx, cy - dy), (cx - dx, cy)]
        poly = plt.Polygon(pts, closed=True,
                           edgecolor=color, facecolor=color + "28",
                           lw=1.4, zorder=3)
        ax.add_patch(poly)
        ax.text(cx, cy, label, ha="center", va="center",
                color=WHITE, fontsize=8.5, zorder=4)

    def arr(x1, y1, x2, y2, lbl=None, color=GREY_LIGHT, rad=0.0):
        arrow(ax, x1, y1, x2, y2, color=color, label=lbl,
              connectionstyle=f"arc3,rad={rad}")

    # ── Row positions (top → bottom, 0.91 → 0.04) ─────────────────────────
    rows = {
        "title":        0.91,
        "visit":        0.875,
        "auth":         0.82,
        "d_existing":   0.76,
        "workplaces":   0.70,
        "d_workplace":  0.645,
        "create_wp":    0.645,
        "add_src":      0.585,
        "d_src_type":   0.526,
        "src_sql":      0.47,
        "src_csv":      0.47,
        "src_demo":     0.47,
        "start_chat":   0.41,
        "d_mode":       0.352,
        "m_quick":      0.295,
        "m_deep":       0.295,
        "m_compare":    0.295,
        "ai_pipeline":  0.237,
        "response":     0.178,
        "d_actions":    0.12,
        "act_pin":      0.063,
        "act_followup": 0.063,
        "act_export":   0.063,
        "history":      0.063,
    }

    # ── Nodes ──────────────────────────────────────────────────────────────
    node(CX, rows["visit"],      "Visit App",                C_FRONT, bold=True)
    node(CX, rows["auth"],       "/auth  — Sign In",         C_FRONT,
         sub="Any username + password (demo auth)")

    dn(CX,   rows["d_existing"], "New user?")

    node(CX, rows["workplaces"], "/workplaces",              C_FRONT, bold=True,
         sub="Create or open a Workplace")

    dn(CX,   rows["d_workplace"], "Workplace\nexists?")
    node(CXL, rows["create_wp"], "Create Workplace",         C_FRONT, w=W_SIDE)

    node(CX, rows["add_src"],    "Add Data Sources",         C_API, bold=True,
         sub="AddSourceWizard")

    dn(CX,   rows["d_src_type"], "Source type?")
    node(0.22, rows["src_sql"],  "SQL Database\n(PostgreSQL / MySQL\n/ SQLite / Turso)",
         C_DATA, w=0.22)
    node(0.50, rows["src_csv"],  "File Upload\n(CSV / Excel\n→ DuckDB)",
         C_DATA, w=0.22)
    node(0.78, rows["src_demo"], "Demo Dataset\n(Banking CSV\npre-loaded)",
         C_DATA, w=0.22)

    node(CX, rows["start_chat"], "Start Chat  →  /chat",     C_FRONT, bold=True,
         sub="Sources bound to session_id")

    dn(CX,   rows["d_mode"],     "Analysis mode?")
    node(0.18, rows["m_quick"],  "[Quick]",                  C_SVC, w=0.18,
         sub="1-sentence answer")
    node(0.50, rows["m_deep"],   "[Deep]",                   C_PIPE, w=0.18,
         sub="Charts + follow-ups")
    node(0.82, rows["m_compare"],"[Compare]",                C_AUDIT, w=0.18,
         sub="Period / group delta")

    node(CX, rows["ai_pipeline"], "AI Pipeline  (LangGraph)",  C_PIPE, bold=True,
         sub="Intent → SQL → Execute → Validate → Narrate")

    node(CX, rows["response"],   "Response",                  C_NARRATOR, bold=True,
         sub="Narrative · SQL · Chart · Trust Trace · Confidence")

    dn(CX,   rows["d_actions"],  "User action?")
    node(0.14, rows["act_pin"],      "Pin Insight\n→ Dashboard",       C_GOLD := GOLD_DIM, w=0.20)
    node(0.38, rows["act_followup"], "Click Follow-up\nSuggestion",    C_SVC,   w=0.20)
    node(0.62, rows["act_export"],   "Export CSV\nor PPTX",            C_API,   w=0.20)
    node(0.86, rows["history"],      "/history\n(past sessions)",       C_FRONT, w=0.20)

    # ── Arrows ─────────────────────────────────────────────────────────────
    arr(CX, rows["visit"] - H/2,    CX, rows["auth"] + H/2)
    arr(CX, rows["auth"] - H/2,     CX, rows["d_existing"] + H*0.7)
    arr(CX, rows["d_existing"] - H*0.7, CX, rows["workplaces"] + H/2,
        lbl="yes", color=GOLD)

    # existing user bypass arrow (left side)
    arr(CX - W_MAIN/2, rows["d_existing"],
        CX - W_MAIN/2, rows["workplaces"],
        lbl="no (return)", color=GREY_LIGHT, rad=-0.25)

    arr(CX, rows["workplaces"] - H/2,  CX, rows["d_workplace"] + H*0.7)
    arr(CX - W_MAIN/2, rows["d_workplace"],
        CXL, rows["create_wp"] + H/2,
        lbl="no", color=GREY_LIGHT)
    arr(CXL, rows["create_wp"] - H/2,
        CX - W_MAIN/2, rows["add_src"],
        color=GREY_LIGHT, rad=0.15)
    arr(CX, rows["d_workplace"] - H*0.7,
        CX, rows["add_src"] + H/2,
        lbl="yes", color=GOLD)

    arr(CX, rows["add_src"] - H/2,     CX, rows["d_src_type"] + H*0.7)
    arr(CX, rows["d_src_type"],         0.22, rows["src_sql"] + H/2,
        lbl="SQL", color=C_DATA)
    arr(CX, rows["d_src_type"] - H*0.7, 0.50, rows["src_csv"] + H/2,
        lbl="CSV/Excel", color=C_DATA)
    arr(CX, rows["d_src_type"],         0.78, rows["src_demo"] + H/2,
        lbl="Demo", color=C_DATA, rad=0.15)

    # merge from src nodes
    arr(0.22, rows["src_sql"] - H/2,    CX, rows["start_chat"] + H/2,
        color=GREY_LIGHT, rad=0.18)
    arr(0.50, rows["src_csv"] - H/2,    CX, rows["start_chat"] + H/2,
        color=GREY_LIGHT)
    arr(0.78, rows["src_demo"] - H/2,   CX, rows["start_chat"] + H/2,
        color=GREY_LIGHT, rad=-0.18)

    arr(CX, rows["start_chat"] - H/2,   CX, rows["d_mode"] + H*0.7)
    arr(CX, rows["d_mode"],             0.18, rows["m_quick"] + H/2,
        lbl="quick", color=C_SVC)
    arr(CX, rows["d_mode"] - H*0.7,     0.50, rows["m_deep"] + H/2,
        lbl="deep", color=C_PIPE)
    arr(CX, rows["d_mode"],             0.82, rows["m_compare"] + H/2,
        lbl="compare", color=C_AUDIT, rad=0.15)

    for mx in [0.18, 0.50, 0.82]:
        arr(mx, rows["m_quick"] - H/2, CX, rows["ai_pipeline"] + H/2,
            color=GREY_LIGHT, rad=0.0 if mx == 0.50 else (0.2 if mx == 0.18 else -0.2))

    arr(CX, rows["ai_pipeline"] - H/2, CX, rows["response"] + H/2)
    arr(CX, rows["response"] - H/2,    CX, rows["d_actions"] + H*0.7)

    arr(CX, rows["d_actions"],          0.14, rows["act_pin"] + H/2,
        lbl="pin", color=GOLD_DIM, rad=0.25)
    arr(CX, rows["d_actions"],          0.38, rows["act_followup"] + H/2,
        lbl="follow-up", color=C_SVC)
    arr(CX, rows["d_actions"] - H*0.7,  0.62, rows["act_export"] + H/2,
        lbl="export", color=C_API)
    arr(CX, rows["d_actions"],          0.86, rows["history"] + H/2,
        lbl="history", color=C_FRONT, rad=-0.25)

    # follow-up loops back to pipeline
    ax.annotate("", xy=(CX + W_MAIN/2, rows["ai_pipeline"]),
                xytext=(0.38 + 0.10, rows["act_followup"]),
                arrowprops=dict(arrowstyle="->", color=C_SVC, lw=1,
                                connectionstyle="arc3,rad=-0.3"), zorder=2)

    # ── Legend ──────────────────────────────────────────────────────────────
    legend_items = [
        (C_FRONT,   "Frontend (Next.js)"),
        (C_API,     "API / Backend"),
        (C_PIPE,    "AI Pipeline"),
        (C_DATA,    "Data Sources"),
        (C_SVC,     "Services / Actions"),
        (GOLD_DIM,  "Insights / Export"),
    ]
    for i, (col, lbl) in enumerate(legend_items):
        bx, by = 0.03, 0.055 - i * 0.028
        ax.add_patch(FancyBboxPatch((bx, by - 0.009), 0.018, 0.018,
                                    boxstyle="round,pad=0,rounding_size=0.003",
                                    facecolor=col + "44", edgecolor=col, lw=1,
                                    transform=ax.transAxes, zorder=4))
        ax.text(bx + 0.026, by + 0.0, lbl, va="center", color=GREY_LIGHT,
                fontsize=7.5, transform=ax.transAxes, zorder=5)

    plt.tight_layout(pad=0.3)
    out = os.path.join(OUT_DIR, "user_journey.png")
    fig.savefig(out, dpi=150, bbox_inches="tight", facecolor=BG)
    plt.close(fig)
    print("[OK] " + out)


# ======================================================================
# DIAGRAM 2 -- SYSTEM ARCHITECTURE
# ═══════════════════════════════════════════════════════════════════════════

def draw_system_architecture():
    fig, ax = fig_dark(18, 13, dpi=150)
    title_text(ax, "YourAnalyst — System Architecture",
               "Five-tier stack: Frontend · API · LangGraph Pipeline · Core Services · Data")

    # ── Tier bands (y-start, y-end, color, label) ──────────────────────────
    tiers = [
        (0.835, 0.97,  C_FRONT,  "TIER 1 — FRONTEND  (Next.js 14 · Vercel)"),
        (0.670, 0.825, C_API,    "TIER 2 — API GATEWAY  (FastAPI · Python 3.11)"),
        (0.415, 0.660, C_PIPE,   "TIER 3 — LANGGRAPH AGENT PIPELINE"),
        (0.215, 0.405, C_SVC,    "TIER 4 — CORE SERVICES"),
        (0.04,  0.205, C_DATA,   "TIER 5 — DATA LAYER"),
    ]

    for y0, y1, col, lbl in tiers:
        rect = FancyBboxPatch((0.01, y0), 0.98, y1 - y0,
                              boxstyle="round,pad=0,rounding_size=0.008",
                              linewidth=1.5, edgecolor=col,
                              facecolor=col + "12", zorder=1)
        ax.add_patch(rect)
        ax.text(0.025, y1 - 0.018, lbl,
                va="top", color=col, fontsize=8.5, fontweight="bold", zorder=4)

    def chip(cx, cy, w, h, text, col, sub=None, fs=8):
        rbox(ax, cx, cy, w, h, text, col, fontsize=fs, sublabel=sub, radius=0.010)

    # ── Tier 1 – Frontend ──────────────────────────────────────────────────
    pages = [
        (0.12, "/auth"),
        (0.30, "/workplaces"),
        (0.50, "/chat"),
        (0.70, "/history"),
    ]
    for cx, lbl in pages:
        chip(cx, 0.920, 0.14, 0.044, lbl, C_FRONT, fs=9)

    components = [
        (0.14, "AddSourceWizard"),
        (0.37, "OnboardingGuide"),
        (0.60, "useAuth · useChat\nuseOnboarding"),
        (0.82, "lib/api.ts\nlib/types.ts"),
    ]
    for cx, lbl in components:
        chip(cx, 0.863, 0.20, 0.040, lbl, C_FRONT, fs=7.8)

    # ── Tier 2 – API ───────────────────────────────────────────────────────
    routers = [
        (0.12, "/api/auth"),
        (0.30, "/api/sources"),
        (0.50, "/api/chat"),
        (0.68, "/api/export"),
        (0.86, "/api/sources\n/{id}/profile"),
    ]
    for cx, lbl in routers:
        chip(cx, 0.748, 0.14, 0.056, lbl, C_API, fs=8.5)

    # REST arrow
    ax.annotate("", xy=(0.5, 0.835), xytext=(0.5, 0.825),
                arrowprops=dict(arrowstyle="<->", color=GOLD, lw=2.0), zorder=6)
    ax.text(0.52, 0.830, "REST / JSON\n(Bearer token)",
            color=GOLD, fontsize=7.5, va="center", zorder=7)

    # ── Tier 3 – Pipeline ──────────────────────────────────────────────────
    # Two rows: left=phase-1 agents, right=phase-2 agents
    row_a_y = 0.618
    row_b_y = 0.550
    row_c_y = 0.478

    agents_a = [
        (0.10, "Semantic\nAgent",   C_SEMANTIC),
        (0.27, "Assumption\nChecker", C_AUDIT),
        (0.44, "SQL\nGenerator",    C_CODER),
        (0.61, "Executor",          C_EXECUTOR),
        (0.78, "Self-Correct\n(↺ ×2)", C_SELFCORR),
    ]
    agents_b = [
        (0.16, "Result\nValidator", C_CRITIC),
        (0.36, "Trust\nScorer",     C_TRUST),
        (0.56, "Insight\nWriter",   C_NARRATOR),
        (0.74, "Chart\nAdvisor",    C_VIZ),
        (0.90, "Followup\nEngine",  C_FOLLOWUP),
    ]

    for cx, lbl, col in agents_a:
        chip(cx, row_a_y, 0.135, 0.052, lbl, col, fs=8)
    for cx, lbl, col in agents_b:
        chip(cx, row_b_y, 0.135, 0.052, lbl, col, fs=8)

    # Mode key
    ax.text(0.50, row_c_y + 0.012,
            "[Quick]: semantic→coder→executor→critic→narrator    "
            "[Deep]: +audit+confidence+viz+followup    "
            "[Compare]: +CTEs+period-delta",
            ha="center", va="center", color=GREY_LIGHT,
            fontsize=7.5, style="italic", zorder=5)

    # Pipeline flow arrows (simplified horizontal)
    ax_pairs_a = [
        (0.10, 0.27), (0.27, 0.44), (0.44, 0.61), (0.61, 0.78)
    ]
    for cx1, cx2 in ax_pairs_a:
        arrow(ax, cx1 + 0.067, row_a_y, cx2 - 0.067, row_a_y,
              color=GREY, lw=1)

    ax_pairs_b = [
        (0.16, 0.36), (0.36, 0.56), (0.56, 0.74), (0.74, 0.90)
    ]
    for cx1, cx2 in ax_pairs_b:
        arrow(ax, cx1 + 0.067, row_b_y, cx2 - 0.067, row_b_y,
              color=GREY, lw=1)

    # executor → critic bridge
    arrow(ax, 0.61, row_a_y - 0.026, 0.16, row_b_y + 0.026,
          color=GREY_LIGHT, lw=1,
          connectionstyle="arc3,rad=0.2")

    # ── Tier 4 – Core Services ─────────────────────────────────────────────
    services = [
        (0.11, "LLM Client\n(key rotation)"),
        (0.27, "Connection\nManager"),
        (0.43, "Query\nExecutor"),
        (0.59, "Source\nRegistry"),
        (0.73, "Session\nManager"),
        (0.865,"Metric\nCatalog"),
    ]
    for cx, lbl in services:
        chip(cx, 0.312, 0.115, 0.072, lbl, C_SVC, fs=8)

    chip(0.955, 0.312, 0.075, 0.072, "Schema\nReader\nIncident\nHandler", C_SVC, fs=7.2)

    # ── Tier 5 – Data Layer ────────────────────────────────────────────────
    sources = [
        (0.12, "PostgreSQL\n(Supabase / local)", C_DATA),
        (0.30, "MySQL\n(TiDB / local)",          C_DATA),
        (0.48, "SQLite / Turso\n(libsql)",        C_DATA),
        (0.66, "CSV / Excel\n→ DuckDB views",     C_DATA),
        (0.84, "Cross-DB Federation\n(ephemeral DuckDB)", C_VIZ),
    ]
    for cx, lbl, col in sources:
        chip(cx, 0.122, 0.16, 0.072, lbl, col, fs=8)

    # ── External – Groq API ────────────────────────────────────────────────
    ext_box = FancyBboxPatch((0.72, 0.340), 0.26, 0.052,
                              boxstyle="round,pad=0,rounding_size=0.008",
                              linewidth=1.5, edgecolor=C_EXT,
                              facecolor=C_EXT + "22", zorder=3)
    ax.add_patch(ext_box)
    ax.text(0.85, 0.366, "GROQ API (external)\nllama-3.3-70b-versatile · llama-3.1-8b-instant",
            ha="center", va="center", color=GREY_LIGHT, fontsize=8, zorder=4)

    # Arrow: LLM Client → Groq
    arrow(ax, 0.11 + 0.057, 0.312 + 0.036, 0.72, 0.366,
          color=C_EXT, lw=1.2, label="API calls",
          connectionstyle="arc3,rad=-0.15")

    # Tier-connection arrows (centre column)
    for y_from, y_to in [(0.835, 0.825), (0.670, 0.660), (0.415, 0.405), (0.215, 0.205)]:
        arrow(ax, 0.50, y_from, 0.50, y_to, color=GREY, lw=1.0)

    # ── Legend ──────────────────────────────────────────────────────────────
    leg = [
        (C_FRONT,    "Frontend"),
        (C_API,      "API Layer"),
        (C_PIPE,     "Pipeline Nodes"),
        (C_SVC,      "Core Services"),
        (C_DATA,     "Data Sources"),
        (C_EXT,      "External Services"),
    ]
    for i, (col, lbl) in enumerate(leg):
        bx, by = 0.015 + i * 0.16, 0.022
        ax.add_patch(FancyBboxPatch((bx, by - 0.010), 0.014, 0.018,
                                    boxstyle="round,pad=0,rounding_size=0.003",
                                    facecolor=col + "44", edgecolor=col, lw=1,
                                    transform=ax.transAxes, zorder=6))
        ax.text(bx + 0.020, by + 0.001, lbl, va="center", color=GREY_LIGHT,
                fontsize=7.5, transform=ax.transAxes, zorder=7)

    plt.tight_layout(pad=0.3)
    out = os.path.join(OUT_DIR, "system_architecture.png")
    fig.savefig(out, dpi=150, bbox_inches="tight", facecolor=BG)
    plt.close(fig)
    print("[OK] " + out)


# ═══════════════════════════════════════════════════════════════════════════
# DIAGRAM 3 — LANGGRAPH PIPELINE ARCHITECTURE
# ═══════════════════════════════════════════════════════════════════════════

def draw_langgraph_pipeline():
    fig, ax = fig_dark(16, 22, dpi=150)
    title_text(ax, "YourAnalyst — LangGraph Agent Pipeline",
               "Directed graph with conditional routing and self-correction loops")

    def node(cx, cy, label, color, sub=None, w=0.24, h=0.055, fs=9):
        rbox(ax, cx, cy, w, h, label, color, fontsize=fs,
             sublabel=sub, radius=0.012, bold=True)

    def terminal(cx, cy, label, color=C_START_END):
        """Rounded pill for START / END."""
        rbox(ax, cx, cy, 0.18, 0.040, label, color,
             fontsize=10, radius=0.020, bold=True)

    def decision(cx, cy, label, color=GOLD):
        """Diamond."""
        dx, dy = 0.14, 0.038
        pts = [(cx, cy + dy), (cx + dx, cy), (cx, cy - dy), (cx - dx, cy)]
        poly = plt.Polygon(pts, closed=True,
                           edgecolor=color, facecolor=color + "28",
                           lw=1.4, zorder=3)
        ax.add_patch(poly)
        ax.text(cx, cy, label, ha="center", va="center",
                color=WHITE, fontsize=8, zorder=4, style="italic")

    def arr(x1, y1, x2, y2, lbl=None, col=GREY_LIGHT, rad=0.0, lw=1.3):
        arrow(ax, x1, y1, x2, y2, color=col, label=lbl, lw=lw,
              connectionstyle=f"arc3,rad={rad}")

    def mode_badge(cx, cy, text, color):
        ax.text(cx, cy, text, ha="center", va="center",
                color=color, fontsize=7.5, fontstyle="italic",
                bbox=dict(facecolor=color + "18", edgecolor=color,
                          boxstyle="round,pad=0.3", lw=0.8),
                zorder=6)

    # ── Layout constants ───────────────────────────────────────────────────
    MX  = 0.50   # main column x
    LX  = 0.18   # left branch (audit)
    RX  = 0.82   # right branch (self-correct)
    NW  = 0.28   # node width
    NH  = 0.055  # node height
    DH  = 0.038  # diamond half-height
    GAP = 0.005  # half-gap for arrow endpoints

    # Y positions (0.95 = top, 0.03 = bottom)
    Y = {
        "start":      0.955,
        "semantic":   0.895,
        "d_route1":   0.833,   # _route_after_semantic
        "audit":      0.773,
        "coder":      0.703,
        "executor":   0.633,
        "d_executor": 0.568,   # _route_after_executor
        "self_corr":  0.568,   # same row, right branch
        "critic":     0.500,
        "d_critic":   0.435,   # _route_after_critic
        "confidence": 0.372,
        "narrator":   0.300,
        "d_narrator": 0.238,   # _route_after_narrator
        "viz":        0.175,
        "followup":   0.105,
        "end":        0.042,
    }

    # ── Draw nodes ─────────────────────────────────────────────────────────
    terminal(MX, Y["start"],     "START",    C_START_END)
    node(MX, Y["semantic"],   "Semantic Agent\n(Intent Parser)",       C_SEMANTIC,
         sub="Resolves question · maps metrics · selects sources")
    decision(MX, Y["d_route1"],  "_route_after_semantic")
    node(LX, Y["audit"],      "Assumption\nChecker",                   C_AUDIT,
         sub="Audits risk per assumption (LOW/MED/HIGH)", w=0.25)
    node(MX, Y["coder"],      "SQL Generator",                         C_CODER,
         sub="Dialect-aware SQL (PostgreSQL/MySQL/SQLite/DuckDB)")
    node(MX, Y["executor"],   "Query Executor",                        C_EXECUTOR,
         sub="Runs SQL · federated cross-DB via DuckDB")
    decision(MX, Y["d_executor"], "_route_after_executor")
    node(RX, Y["self_corr"],  "Self-Correct\n(↺ max 2 retries)",      C_SELFCORR,
         sub="Revise SQL with error context", w=0.24)
    node(MX, Y["critic"],     "Result Validator",                      C_CRITIC,
         sub="Structural + semantic verification")
    decision(MX, Y["d_critic"],  "_route_after_critic")
    node(LX, Y["confidence"], "Trust Scorer",                          C_TRUST,
         sub="0–100 score · deductions for risk/retry", w=0.25)
    node(MX, Y["narrator"],   "Insight Writer\n(Narrator)",            C_NARRATOR,
         sub="Bloomberg-style business narrative")
    decision(MX, Y["d_narrator"], "_route_after_narrator")
    node(LX, Y["viz"],        "Chart Advisor",                         C_VIZ,
         sub="bar / line / pie / scatter / table / none", w=0.25)
    node(MX, Y["followup"],   "Followup Engine",                       C_FOLLOWUP,
         sub="Generates 3 contextual next questions")
    terminal(MX, Y["end"],       "END",      C_START_END)

    # ── Arrows — main flow ─────────────────────────────────────────────────
    # START → semantic
    arr(MX, Y["start"] - 0.020,         MX, Y["semantic"] + NH/2)
    # semantic → decision
    arr(MX, Y["semantic"] - NH/2,       MX, Y["d_route1"] + DH)
    # decision → audit (left, deep/compare)
    arr(MX - 0.14, Y["d_route1"],       LX + 0.125, Y["audit"] + NH/2,
        lbl="deep / compare", col=C_AUDIT)
    # decision → coder (straight down, quick)
    arr(MX, Y["d_route1"] - DH,         MX, Y["coder"] + NH/2,
        lbl="quick [Q]", col=C_SVC)
    # audit → coder
    arr(LX, Y["audit"] - NH/2,          MX - NW/2, Y["coder"] + NH*0.2,
        col=C_AUDIT, rad=0.1)
    # coder → executor
    arr(MX, Y["coder"] - NH/2,          MX, Y["executor"] + NH/2)
    # executor → decision
    arr(MX, Y["executor"] - NH/2,       MX, Y["d_executor"] + DH)
    # decision → self_correct (right)
    arr(MX + 0.14, Y["d_executor"],     RX - 0.12, Y["self_corr"] + NH/2,
        lbl="error + retry < 2", col=C_SELFCORR)
    # self_correct loop → executor
    ax.annotate("", xy=(MX + NW/2, Y["executor"]),
                xytext=(RX - 0.12, Y["self_corr"] + NH/2),
                arrowprops=dict(arrowstyle="->", color=C_SELFCORR, lw=1.3,
                                connectionstyle="arc3,rad=-0.35"), zorder=4)
    ax.text(RX + 0.03, (Y["executor"] + Y["self_corr"]) / 2 + 0.01,
            "revise SQL\n↺", color=C_SELFCORR, fontsize=7.5, ha="left", zorder=5)
    # decision → critic (down)
    arr(MX, Y["d_executor"] - DH,       MX, Y["critic"] + NH/2,
        lbl="ok / retries done", col=GOLD)
    # critic → decision
    arr(MX, Y["critic"] - NH/2,         MX, Y["d_critic"] + DH)
    # d_critic → self_correct (retry on fail)
    ax.annotate("", xy=(RX - 0.12, Y["self_corr"] - NH/2),
                xytext=(MX + 0.14, Y["d_critic"]),
                arrowprops=dict(arrowstyle="->", color=C_SELFCORR, lw=1,
                                connectionstyle="arc3,rad=-0.2"), zorder=4)
    ax.text(RX + 0.01, Y["d_critic"] - 0.02,
            "not verified\n+ retry < 2", color=C_SELFCORR, fontsize=7, ha="left", zorder=5)
    # d_critic → confidence (left, deep/compare)
    arr(MX - 0.14, Y["d_critic"],       LX + 0.125, Y["confidence"] + NH/2,
        lbl="deep / compare", col=C_TRUST)
    # confidence → narrator
    arr(LX, Y["confidence"] - NH/2,     MX - NW/2, Y["narrator"] + NH*0.2,
        col=C_TRUST, rad=0.1)
    # d_critic → narrator (quick)
    arr(MX, Y["d_critic"] - DH,         MX, Y["narrator"] + NH/2,
        lbl="quick [Q]", col=C_SVC)
    # narrator → d_narrator
    arr(MX, Y["narrator"] - NH/2,       MX, Y["d_narrator"] + DH)
    # d_narrator → viz (left, deep/compare)
    arr(MX - 0.14, Y["d_narrator"],     LX + 0.125, Y["viz"] + NH/2,
        lbl="deep / compare", col=C_VIZ)
    # viz → followup
    arr(LX, Y["viz"] - NH/2,            MX - NW/2, Y["followup"] + NH*0.2,
        col=C_VIZ, rad=0.1)
    # d_narrator → END (quick)
    arr(MX, Y["d_narrator"] - DH,       MX, Y["end"] + 0.020,
        lbl="quick [Q]  → END", col=C_SVC, rad=-0.2)
    # followup → END
    arr(MX, Y["followup"] - NH/2,       MX, Y["end"] + 0.020)

    # ── Mode annotation boxes ──────────────────────────────────────────────
    mode_badge(0.08, 0.81,  "[Quick] only",    C_SVC)
    mode_badge(0.08, 0.76,  "[Deep] / [Compare]", C_AUDIT)
    mode_badge(0.08, 0.57,  "[C] Self-correction\nloop (max ×2)", C_SELFCORR)
    mode_badge(0.08, 0.43,  "[Deep] / [Compare]", C_TRUST)
    mode_badge(0.08, 0.24,  "[Deep] / [Compare]", C_VIZ)

    # ── State fields annotation ────────────────────────────────────────────
    state_text = (
        "Shared State (PipelineState TypedDict)\n"
        "session_id · user_question · mode · source_ids\n"
        "resolved_question · metric_mappings · assumptions\n"
        "generated_code · execution_result · trust_trace\n"
        "confidence_score · insight_narrative · visualization\n"
        "suggested_followups · retry_count · is_verified"
    )
    ax.text(0.97, 0.50, state_text,
            ha="right", va="center", color=GREY_LIGHT, fontsize=7,
            linespacing=1.5,
            bbox=dict(facecolor=C_SVC + "18", edgecolor=C_SVC,
                      boxstyle="round,pad=0.5", lw=0.8),
            zorder=6)

    # ── Legend ──────────────────────────────────────────────────────────────
    leg = [
        (C_SEMANTIC,  "Intent Parser"),
        (C_AUDIT,     "Audit / Critic"),
        (C_CODER,     "SQL Generator"),
        (C_EXECUTOR,  "Executor"),
        (C_SELFCORR,  "Self-Correct"),
        (C_TRUST,     "Trust Scorer"),
        (C_NARRATOR,  "Narrator"),
        (C_VIZ,       "Chart Advisor"),
        (C_FOLLOWUP,  "Followup Engine"),
    ]
    for i, (col, lbl) in enumerate(leg):
        bx, by = 0.01 + (i % 5) * 0.19, 0.028 - (i // 5) * 0.020
        ax.add_patch(FancyBboxPatch((bx, by - 0.007), 0.012, 0.014,
                                    boxstyle="round,pad=0,rounding_size=0.003",
                                    facecolor=col + "44", edgecolor=col, lw=1,
                                    transform=ax.transAxes, zorder=6))
        ax.text(bx + 0.017, by + 0.0, lbl, va="center", color=GREY_LIGHT,
                fontsize=7, transform=ax.transAxes, zorder=7)

    plt.tight_layout(pad=0.3)
    out = os.path.join(OUT_DIR, "langgraph_pipeline.png")
    fig.savefig(out, dpi=150, bbox_inches="tight", facecolor=BG)
    plt.close(fig)
    print("[OK] " + out)


# ═══════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("Generating YourAnalyst diagrams…")
    draw_user_journey()
    draw_system_architecture()
    draw_langgraph_pipeline()
    print("\nAll diagrams saved to docs/images/")
