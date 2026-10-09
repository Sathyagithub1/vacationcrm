// VacayCRM pitch deck — for tourism & travel companies
// Grounded in the real product feature inventory (docs/proposals/vendor-3-pager.md + src route map)
const pptxgen = require("pptxgenjs");
const React = require("react");
const ReactDOMServer = require("react-dom/server");
const sharp = require("sharp");
const FA = require("react-icons/fa");

// ---------- palette ----------
const NAVY   = "0A2540"; // primary dark
const NAVY2  = "061A2E"; // deeper
const TEAL   = "0FB5A6"; // brand
const TEALLT = "5EEAD4"; // light teal
const GOLD   = "F5A623"; // sunset accent / CTA
const LIGHT  = "F5F8FB"; // page bg
const WHITE  = "FFFFFF";
const INK    = "12283A"; // body text on light
const MUTED  = "5B7186"; // muted
const CARD   = "FFFFFF";
const LINE   = "E3EBF2";

const HFONT = "Georgia";      // editorial / premium travel feel
const BFONT = "Calibri";      // clean body

// ---------- icon helpers ----------
async function iconPng(IconComponent, color = "#FFFFFF", size = 256) {
  const svg = ReactDOMServer.renderToStaticMarkup(
    React.createElement(IconComponent, { color, size: String(size) })
  );
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return "image/png;base64," + buf.toString("base64");
}
const ICONS = {};
async function preload() {
  const need = {
    whatsapp: FA.FaWhatsapp, facebook: FA.FaFacebookF, instagram: FA.FaInstagram,
    envelope: FA.FaEnvelope, sms: FA.FaSms, telegram: FA.FaTelegramPlane, globe: FA.FaGlobe,
    filter: FA.FaFilter, robot: FA.FaRobot, userCheck: FA.FaUserCheck, route: FA.FaRoute,
    map: FA.FaMapMarkedAlt, ticket: FA.FaTicketAlt, bag: FA.FaSuitcaseRolling, list: FA.FaClipboardList,
    usersCog: FA.FaUsersCog, scale: FA.FaBalanceScale, brain: FA.FaBrain, layers: FA.FaLayerGroup,
    shield: FA.FaShieldAlt, lock: FA.FaLock, server: FA.FaServer, sitemap: FA.FaSitemap,
    chart: FA.FaChartLine, bolt: FA.FaBolt, check: FA.FaCheckCircle, clock: FA.FaClock,
    warn: FA.FaExclamationTriangle, inbox: FA.FaInboxIn || FA.FaInbox, plug: FA.FaPlug,
    handshake: FA.FaHandshake, rocket: FA.FaRocket, cogs: FA.FaCogs, star: FA.FaStar,
    phone: FA.FaPhoneAlt, tag: FA.FaTags, funnel: FA.FaFilter, coins: FA.FaCoins,
    calendar: FA.FaCalendarCheck, graduation: FA.FaChalkboardTeacher, headset: FA.FaHeadset,
    palette: FA.FaPalette, arrow: FA.FaArrowRight
  };
  const colorFor = {}; // default white; overridden inline where needed
  for (const [k, C] of Object.entries(need)) {
    ICONS[k] = { comp: C };
  }
}
// cache by (name,color)
const _cache = {};
async function ic(name, color) {
  const key = name + color;
  if (!_cache[key]) _cache[key] = await iconPng(ICONS[name].comp, color, 256);
  return _cache[key];
}

const shadow = () => ({ type: "outer", color: "0A2540", blur: 9, offset: 3, angle: 90, opacity: 0.16 });

// ---------- deck ----------
const pres = new pptxgen();
pres.defineLayout({ name: "W", width: 13.333, height: 7.5 });
pres.layout = "W";
pres.author = "VacayCRM";
pres.title = "VacayCRM — The CRM built for travel businesses";
const PW = 13.333, PH = 7.5;

// footer for content slides
function footer(slide, n) {
  slide.addText([
    { text: "VacayCRM", options: { bold: true, color: TEAL } },
    { text: "   ·   vacaycrm.app", options: { color: MUTED } }
  ], { x: 0.6, y: 7.02, w: 6, h: 0.35, fontFace: BFONT, fontSize: 9.5, align: "left", valign: "middle" });
  slide.addText(String(n).padStart(2, "0"), {
    x: 12.2, y: 7.02, w: 0.6, h: 0.35, fontFace: BFONT, fontSize: 9.5, color: MUTED, align: "right", valign: "middle"
  });
}

// eyebrow + title block for light content slides
function head(slide, eyebrow, title, titleW = 11.5) {
  slide.addText(eyebrow.toUpperCase(), {
    x: 0.6, y: 0.5, w: titleW, h: 0.35, fontFace: BFONT, fontSize: 12, bold: true,
    color: TEAL, charSpacing: 3, align: "left"
  });
  slide.addText(title, {
    x: 0.58, y: 0.82, w: titleW, h: 0.9, fontFace: HFONT, fontSize: 30, bold: true,
    color: INK, align: "left"
  });
}

async function build() {
  await preload();

  // ============ SLIDE 1 — TITLE ============
  {
    const s = pres.addSlide();
    s.background = { color: NAVY };
    // ambient shapes
    s.addShape(pres.shapes.OVAL, { x: 9.4, y: -2.2, w: 6.5, h: 6.5, fill: { color: TEAL, transparency: 82 }, line: { type: "none" } });
    s.addShape(pres.shapes.OVAL, { x: 11.0, y: 3.8, w: 5.5, h: 5.5, fill: { color: GOLD, transparency: 88 }, line: { type: "none" } });
    s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 0.22, h: PH, fill: { color: TEAL }, line: { type: "none" } });

    // brand lockup
    s.addImage({ data: await ic("map", "#" + TEALLT), x: 0.9, y: 0.75, w: 0.5, h: 0.5 });
    s.addText("VACAYCRM", { x: 1.5, y: 0.72, w: 6, h: 0.55, fontFace: HFONT, fontSize: 22, bold: true, color: WHITE, charSpacing: 2, valign: "middle" });

    s.addText("The CRM built for\ntravel businesses.", {
      x: 0.9, y: 2.35, w: 9.6, h: 2.1, fontFace: HFONT, fontSize: 52, bold: true, color: WHITE, lineSpacingMultiple: 1.0
    });
    s.addText("Turn every enquiry — from WhatsApp, Meta, Google Forms, calls and your website — into a booking. One triaged pipeline. Intelligent routing. AI that works the funnel while your agents close.", {
      x: 0.95, y: 4.55, w: 8.7, h: 1.2, fontFace: BFONT, fontSize: 16.5, color: TEALLT, lineSpacingMultiple: 1.15
    });

    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.95, y: 6.05, w: 4.9, h: 0.62, fill: { color: GOLD }, rectRadius: 0.31, line: { type: "none" } });
    s.addText("A pitch for tour operators, DMCs & travel agencies", {
      x: 0.95, y: 6.05, w: 4.9, h: 0.62, fontFace: BFONT, fontSize: 12.5, bold: true, color: NAVY2, align: "center", valign: "middle"
    });
  }

  // ============ SLIDE 2 — THE PROBLEM ============
  {
    const s = pres.addSlide();
    s.background = { color: LIGHT };
    head(s, "The problem", "Your leads arrive everywhere — and slip through the cracks");

    const pains = [
      { i: "inbox", t: "Scattered across channels", d: "WhatsApp here, Instagram DMs there, Google Forms, missed calls and website chat. No single place to see every enquiry." },
      { i: "clock", t: "Slow first response", d: "The first agent to reply usually wins the booking. Manual triage means hours lost — and travellers book with whoever answers first." },
      { i: "warn", t: "Leads fall through", d: "No dedup, no owner, no follow-up. Repeat enquiries create duplicate records and hot leads go cold in a shared inbox." },
      { i: "funnel", t: "No pipeline visibility", d: "Spreadsheets can't show stage, source, agent load or why a deal was lost. You're flying blind on conversion." },
    ];
    const cw = 5.75, ch = 2.05, gx = 0.6, gy = 0.35;
    const x0 = 0.6, y0 = 2.05;
    for (let k = 0; k < pains.length; k++) {
      const col = k % 2, row = Math.floor(k / 2);
      const x = x0 + col * (cw + gx), y = y0 + row * (ch + gy);
      s.addShape(pres.shapes.RECTANGLE, { x, y, w: cw, h: ch, fill: { color: CARD }, line: { color: LINE, width: 1 }, shadow: shadow() });
      s.addShape(pres.shapes.RECTANGLE, { x, y, w: 0.09, h: ch, fill: { color: GOLD }, line: { type: "none" } });
      s.addShape(pres.shapes.OVAL, { x: x + 0.35, y: y + 0.35, w: 0.72, h: 0.72, fill: { color: "FDEFD6" }, line: { type: "none" } });
      s.addImage({ data: await ic(pains[k].i, "#C9720B"), x: x + 0.53, y: y + 0.53, w: 0.36, h: 0.36 });
      s.addText(pains[k].t, { x: x + 1.35, y: y + 0.32, w: cw - 1.6, h: 0.5, fontFace: HFONT, fontSize: 17, bold: true, color: INK, valign: "middle" });
      s.addText(pains[k].d, { x: x + 1.35, y: y + 0.86, w: cw - 1.65, h: 1.0, fontFace: BFONT, fontSize: 12.5, color: MUTED, lineSpacingMultiple: 1.05 });
    }
    footer(s, 2);
  }

  // ============ SLIDE 3 — COST STATS ============
  {
    const s = pres.addSlide();
    s.background = { color: NAVY };
    s.addShape(pres.shapes.OVAL, { x: -2, y: 4.2, w: 6, h: 6, fill: { color: TEAL, transparency: 86 }, line: { type: "none" } });
    s.addText("THE COST OF A LEAKY FUNNEL", { x: 0.9, y: 0.8, w: 11, h: 0.4, fontFace: BFONT, fontSize: 13, bold: true, color: TEALLT, charSpacing: 3 });
    s.addText("Every unanswered enquiry is a holiday someone booked elsewhere.", {
      x: 0.88, y: 1.2, w: 11.3, h: 1.0, fontFace: HFONT, fontSize: 30, bold: true, color: WHITE
    });

    const stats = [
      { n: "78%", l: "of buyers choose the vendor that responds first¹", c: GOLD },
      { n: "5×", l: "lower odds of qualifying a lead after the first hour²", c: TEALLT },
      { n: "7", l: "channels a modern travel business must watch at once", c: WHITE },
      { n: "0", l: "leads lost — the target VacayCRM is built to hit", c: GOLD },
    ];
    const cw = 2.75, gx = 0.35, x0 = 0.9, y = 3.0, h = 2.7;
    for (let k = 0; k < stats.length; k++) {
      const x = x0 + k * (cw + gx);
      s.addShape(pres.shapes.RECTANGLE, { x, y, w: cw, h, fill: { color: NAVY2 }, line: { color: "17324B", width: 1 } });
      s.addShape(pres.shapes.RECTANGLE, { x, y, w: cw, h: 0.11, fill: { color: stats[k].c }, line: { type: "none" } });
      s.addText(stats[k].n, { x, y: y + 0.5, w: cw, h: 1.15, fontFace: HFONT, fontSize: 58, bold: true, color: stats[k].c, align: "center" });
      s.addText(stats[k].l, { x: x + 0.22, y: y + 1.75, w: cw - 0.44, h: 0.85, fontFace: BFONT, fontSize: 12, color: "C6D6E4", align: "center", lineSpacingMultiple: 1.05 });
    }
    s.addText("¹ Lead-response research, InsideSales/Harvard Business Review.   ² Time-to-lead studies, industry benchmarks.", {
      x: 0.9, y: 6.15, w: 11.5, h: 0.35, fontFace: BFONT, fontSize: 9.5, italic: true, color: "8AA1B5"
    });
  }

  // ============ SLIDE 4 — SOLUTION OVERVIEW ============
  {
    const s = pres.addSlide();
    s.background = { color: LIGHT };
    head(s, "The solution", "One platform. Every channel. One booking pipeline.");
    s.addText("VacayCRM unifies every inbound enquiry into a single triaged pipeline, then routes it to the right agent automatically — with AI handling the busywork end to end.", {
      x: 0.6, y: 1.72, w: 8.4, h: 0.9, fontFace: BFONT, fontSize: 14.5, color: MUTED, lineSpacingMultiple: 1.15
    });

    // flow: channels -> pipeline -> agent
    const flow = [
      { i: "plug", t: "Capture", d: "7 channels normalized to one intake shape" },
      { i: "filter", t: "Triage", d: "Spam screen · dedupe · department & tour match" },
      { i: "userCheck", t: "Assign", d: "Right agent, instantly, by your strategy" },
      { i: "chart", t: "Convert", d: "Pipeline, follow-ups & 360° customer view" },
    ];
    const cw = 2.85, gx = 0.28, x0 = 0.6, y = 3.05, h = 2.35;
    for (let k = 0; k < flow.length; k++) {
      const x = x0 + k * (cw + gx);
      s.addShape(pres.shapes.RECTANGLE, { x, y, w: cw, h, fill: { color: CARD }, line: { color: LINE, width: 1 }, shadow: shadow() });
      s.addShape(pres.shapes.OVAL, { x: x + cw / 2 - 0.42, y: y + 0.32, w: 0.84, h: 0.84, fill: { color: NAVY }, line: { type: "none" } });
      s.addImage({ data: await ic(flow[k].i, "#5EEAD4"), x: x + cw / 2 - 0.24, y: y + 0.5, w: 0.48, h: 0.48 });
      s.addText(flow[k].t, { x, y: y + 1.28, w: cw, h: 0.4, fontFace: HFONT, fontSize: 18, bold: true, color: INK, align: "center" });
      s.addText(flow[k].d, { x: x + 0.2, y: y + 1.68, w: cw - 0.4, h: 0.6, fontFace: BFONT, fontSize: 11.5, color: MUTED, align: "center", lineSpacingMultiple: 1.05 });
      if (k < flow.length - 1) {
        s.addImage({ data: await ic("arrow", "#" + GOLD), x: x + cw + gx / 2 - 0.13, y: y + h / 2 - 0.13, w: 0.26, h: 0.26 });
      }
    }
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.6, y: 5.85, w: 12.15, h: 0.85, fill: { color: "E7FBF7" }, line: { color: TEAL, width: 1 }, rectRadius: 0.12 });
    s.addImage({ data: await ic("bolt", "#0FB5A6"), x: 0.95, y: 6.07, w: 0.4, h: 0.4 });
    s.addText([
      { text: "Production-grade & already built. ", options: { bold: true, color: NAVY } },
      { text: "This is a proven platform you deploy and brand — not a project you wait months to see.", options: { color: INK } }
    ], { x: 1.5, y: 5.85, w: 11, h: 0.85, fontFace: BFONT, fontSize: 13.5, valign: "middle" });
    footer(s, 4);
  }

  // ============ SLIDE 5 — UNIFIED CONVERSATION HUB ============
  {
    const s = pres.addSlide();
    s.background = { color: LIGHT };
    head(s, "Feature · Unified inbox", "Every conversation in one hub");
    s.addText("WhatsApp, Facebook, Instagram, email, SMS, Telegram and website chat — all in a single inbox with read & delivery tracking, canned responses, file sharing and broadcasts.", {
      x: 0.6, y: 1.72, w: 7.0, h: 1.3, fontFace: BFONT, fontSize: 15, color: MUTED, lineSpacingMultiple: 1.2
    });

    const feats = [
      "One thread per customer, across every channel",
      "Bot, agent & customer message types with delivery status",
      "Escalation: agent → senior agent → admin, with reason capture",
      "Canned responses, uploads & one-to-many broadcasts",
    ];
    let fy = 3.35;
    for (const f of feats) {
      s.addImage({ data: await ic("check", "#0FB5A6"), x: 0.62, y: fy + 0.02, w: 0.34, h: 0.34 });
      s.addText(f, { x: 1.1, y: fy - 0.05, w: 6.4, h: 0.5, fontFace: BFONT, fontSize: 14, color: INK, valign: "middle" });
      fy += 0.72;
    }

    // channel chips panel
    const panelX = 8.1, panelY = 1.75, panelW = 4.65, panelH = 4.9;
    s.addShape(pres.shapes.RECTANGLE, { x: panelX, y: panelY, w: panelW, h: panelH, fill: { color: NAVY }, line: { type: "none" }, shadow: shadow() });
    s.addText("CHANNELS, UNIFIED", { x: panelX + 0.35, y: panelY + 0.32, w: panelW - 0.7, h: 0.4, fontFace: BFONT, fontSize: 12, bold: true, color: TEALLT, charSpacing: 2 });
    const chans = [
      { i: "whatsapp", t: "WhatsApp" }, { i: "facebook", t: "Facebook" },
      { i: "instagram", t: "Instagram" }, { i: "envelope", t: "Email" },
      { i: "sms", t: "SMS" }, { i: "telegram", t: "Telegram" },
      { i: "globe", t: "Web chat" }, { i: "phone", t: "Calls" },
    ];
    const chW = 1.95, chH = 0.8, cgx = 0.22, cgy = 0.16, cx0 = panelX + 0.35, cy0 = panelY + 0.9;
    for (let k = 0; k < chans.length; k++) {
      const col = k % 2, row = Math.floor(k / 2);
      const x = cx0 + col * (chW + cgx), y = cy0 + row * (chH + cgy);
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w: chW, h: chH, fill: { color: NAVY2 }, line: { color: "1C3A55", width: 1 }, rectRadius: 0.08 });
      s.addImage({ data: await ic(chans[k].i, "#5EEAD4"), x: x + 0.2, y: y + 0.25, w: 0.36, h: 0.36 });
      s.addText(chans[k].t, { x: x + 0.68, y, w: chW - 0.75, h: chH, fontFace: BFONT, fontSize: 12.5, bold: true, color: WHITE, valign: "middle" });
    }
    footer(s, 5);
  }

  // ============ SLIDE 6 — SMART INTAKE & ROUTING ============
  {
    const s = pres.addSlide();
    s.background = { color: LIGHT };
    head(s, "Feature · Intake engine", "A 7-stage pipeline that triages every lead");
    s.addText("The moment an enquiry lands, VacayCRM runs it through an automated pipeline — so agents only ever touch clean, deduplicated, correctly-routed leads.", {
      x: 0.6, y: 1.72, w: 12, h: 0.7, fontFace: BFONT, fontSize: 14.5, color: MUTED, lineSpacingMultiple: 1.15
    });

    const steps = [
      "Spam screen", "Field normalize", "De-duplicate", "Department route",
      "Tour match", "Create record", "Assign agent"
    ];
    const n = steps.length, cw = 1.62, gx = 0.13, x0 = 0.6, y = 2.75, h = 1.5;
    for (let k = 0; k < n; k++) {
      const x = x0 + k * (cw + gx);
      s.addShape(pres.shapes.RECTANGLE, { x, y, w: cw, h, fill: { color: CARD }, line: { color: LINE, width: 1 }, shadow: shadow() });
      s.addShape(pres.shapes.RECTANGLE, { x, y, w: cw, h: 0.09, fill: { color: TEAL }, line: { type: "none" } });
      s.addText(String(k + 1), { x, y: y + 0.22, w: cw, h: 0.55, fontFace: HFONT, fontSize: 26, bold: true, color: TEAL, align: "center" });
      s.addText(steps[k], { x: x + 0.08, y: y + 0.82, w: cw - 0.16, h: 0.6, fontFace: BFONT, fontSize: 11.5, bold: true, color: INK, align: "center", valign: "top", lineSpacingMultiple: 0.95 });
      if (k < n - 1) s.addImage({ data: await ic("arrow", "#F5A623"), x: x + cw + gx / 2 - 0.09, y: y + h / 2 - 0.09, w: 0.18, h: 0.18 });
    }

    const cards = [
      { i: "robot", t: "AI spam classification", d: "Per-tenant thresholds + rule-based blacklists keep junk out of your pipeline." },
      { i: "layers", t: "Auto field-mapping", d: "Unknown form fields are detected and proposed to admins automatically." },
      { i: "shield", t: "Zero data leakage", d: "Cross-tenant isolation enforced at the query layer — tested at every join." },
    ];
    const kw = 3.95, kgx = 0.22, kx0 = 0.6, ky = 4.75, kh = 1.75;
    for (let k = 0; k < cards.length; k++) {
      const x = kx0 + k * (kw + kgx);
      s.addShape(pres.shapes.RECTANGLE, { x, y: ky, w: kw, h: kh, fill: { color: "0A2540" }, line: { type: "none" }, shadow: shadow() });
      s.addImage({ data: await ic(cards[k].i, "#5EEAD4"), x: x + 0.3, y: ky + 0.32, w: 0.5, h: 0.5 });
      s.addText(cards[k].t, { x: x + 0.3, y: ky + 0.92, w: kw - 0.6, h: 0.4, fontFace: HFONT, fontSize: 15, bold: true, color: WHITE });
      s.addText(cards[k].d, { x: x + 0.3, y: ky + 1.28, w: kw - 0.6, h: 0.45, fontFace: BFONT, fontSize: 11.5, color: "C6D6E4", lineSpacingMultiple: 1.02 });
    }
    footer(s, 6);
  }

  // ============ SLIDE 7 — TOUR CATALOG & BOOKINGS ============
  {
    const s = pres.addSlide();
    s.background = { color: LIGHT };
    head(s, "Feature · Tours & bookings", "A tour catalog that manages itself");

    const left = [
      { i: "bag", t: "Tour SKUs with real inventory", d: "Code, capacity, start/end dates, department ownership and tag-based metadata." },
      { i: "ticket", t: "Auto sold-out & reopen", d: "Flips to SOLD_OUT when confirmed bookings hit capacity — reopens on cancellation." },
      { i: "brain", t: "AI tour matching", d: "Matches free-text enquiries to real tours, with anti-hallucination guards (confidence ≥ 0.8 + catalog check)." },
      { i: "star", t: "Built-in waitlist flow", d: "Sold-out enquiry? It drafts a contextual reply and tags the lead high-priority." },
    ];
    let y = 1.95;
    for (const f of left) {
      s.addShape(pres.shapes.OVAL, { x: 0.62, y: y + 0.05, w: 0.66, h: 0.66, fill: { color: "E7FBF7" }, line: { type: "none" } });
      s.addImage({ data: await ic(f.i, "#0FB5A6"), x: 0.78, y: y + 0.21, w: 0.34, h: 0.34 });
      s.addText(f.t, { x: 1.45, y: y, w: 6.0, h: 0.4, fontFace: HFONT, fontSize: 16, bold: true, color: INK });
      s.addText(f.d, { x: 1.45, y: y + 0.4, w: 6.05, h: 0.75, fontFace: BFONT, fontSize: 12.5, color: MUTED, lineSpacingMultiple: 1.05 });
      y += 1.2;
    }

    // right visual: mock catalog
    const px = 8.05, py = 1.95, pw = 4.7, ph = 4.55;
    s.addShape(pres.shapes.RECTANGLE, { x: px, y: py, w: pw, h: ph, fill: { color: NAVY }, line: { type: "none" }, shadow: shadow() });
    s.addText("TOUR CATALOG", { x: px + 0.35, y: py + 0.3, w: pw - 0.7, h: 0.4, fontFace: BFONT, fontSize: 12, bold: true, color: TEALLT, charSpacing: 2 });
    const rows = [
      { c: "KER-BACKW-5D", n: "Kerala Backwaters", s: "24 / 30", ok: true },
      { c: "LEH-LADAKH-7D", n: "Leh–Ladakh Expedition", s: "SOLD OUT", ok: false },
      { c: "GOA-BEACH-4D", n: "Goa Beach Escape", s: "12 / 40", ok: true },
      { c: "RAJ-HERITAGE-6D", n: "Rajasthan Heritage", s: "38 / 40", ok: true },
    ];
    let ry = py + 0.9;
    for (const r of rows) {
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: px + 0.3, y: ry, w: pw - 0.6, h: 0.8, fill: { color: NAVY2 }, line: { color: "1C3A55", width: 1 }, rectRadius: 0.06 });
      s.addText(r.n, { x: px + 0.5, y: ry + 0.1, w: 2.7, h: 0.32, fontFace: BFONT, fontSize: 12.5, bold: true, color: WHITE });
      s.addText(r.c, { x: px + 0.5, y: ry + 0.42, w: 2.7, h: 0.28, fontFace: BFONT, fontSize: 9.5, color: "8AA1B5" });
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: px + pw - 1.55, y: ry + 0.24, w: 1.2, h: 0.34, fill: { color: r.ok ? "0FB5A6" : "E4573E" }, line: { type: "none" }, rectRadius: 0.17 });
      s.addText(r.s, { x: px + pw - 1.55, y: ry + 0.24, w: 1.2, h: 0.34, fontFace: BFONT, fontSize: 9.5, bold: true, color: WHITE, align: "center", valign: "middle" });
      ry += 0.92;
    }
    footer(s, 7);
  }

  // ============ SLIDE 8 — ASSIGNMENT ENGINE ============
  {
    const s = pres.addSlide();
    s.background = { color: LIGHT };
    head(s, "Feature · Assignment engine", "Five ways to route the right lead to the right agent");
    s.addText("Switchable per business, with a built-in fallback ladder that escalates to admins — so no lead is ever left unassigned.", {
      x: 0.6, y: 1.72, w: 12, h: 0.5, fontFace: BFONT, fontSize: 14.5, color: MUTED
    });

    const strat = [
      { i: "route", t: "Round-Robin", d: "Race-safe rotation via Postgres advisory-lock cursor." },
      { i: "scale", t: "Load-Balanced", d: "Fewest open leads, least-recent-assignment tiebreaker." },
      { i: "usersCog", t: "Skill-Based", d: "Language & tag matching, with graceful fallback." },
      { i: "brain", t: "AI-Tiered", d: "Lead-score cutoffs route to senior/junior tiers with cascade." },
      { i: "layers", t: "Named Pools", d: "Priority-ordered pools matched by source or department." },
    ];
    const cw = 3.75, ch = 1.9, gx = 0.32, gy = 0.3, x0 = 0.6, y0 = 2.5;
    for (let k = 0; k < strat.length; k++) {
      const col = k % 3, row = Math.floor(k / 3);
      const x = x0 + col * (cw + gx), y = y0 + row * (ch + gy);
      s.addShape(pres.shapes.RECTANGLE, { x, y, w: cw, h: ch, fill: { color: CARD }, line: { color: LINE, width: 1 }, shadow: shadow() });
      s.addShape(pres.shapes.OVAL, { x: x + 0.3, y: y + 0.32, w: 0.7, h: 0.7, fill: { color: NAVY }, line: { type: "none" } });
      s.addImage({ data: await ic(strat[k].i, "#5EEAD4"), x: x + 0.47, y: y + 0.49, w: 0.36, h: 0.36 });
      s.addText(String(k + 1), { x: x + cw - 0.75, y: y + 0.2, w: 0.5, h: 0.5, fontFace: HFONT, fontSize: 26, bold: true, color: "DDE7EF", align: "right" });
      s.addText(strat[k].t, { x: x + 1.2, y: y + 0.34, w: cw - 1.4, h: 0.6, fontFace: HFONT, fontSize: 16.5, bold: true, color: INK, valign: "middle" });
      s.addText(strat[k].d, { x: x + 0.32, y: y + 1.12, w: cw - 0.6, h: 0.65, fontFace: BFONT, fontSize: 12, color: MUTED, lineSpacingMultiple: 1.03 });
    }
    // 6th cell: fallback highlight
    const x = x0 + 2 * (cw + gx), y = y0 + 1 * (ch + gy);
    s.addShape(pres.shapes.RECTANGLE, { x, y, w: cw, h: ch, fill: { color: GOLD }, line: { type: "none" }, shadow: shadow() });
    s.addImage({ data: await ic("shield", "#" + NAVY2), x: x + 0.32, y: y + 0.34, w: 0.5, h: 0.5 });
    s.addText("Fallback ladder", { x: x + 0.95, y: y + 0.34, w: cw - 1.2, h: 0.5, fontFace: HFONT, fontSize: 16.5, bold: true, color: NAVY2, valign: "middle" });
    s.addText("No eligible agent? It escalates to company admins with notifications — automatically.", { x: x + 0.32, y: y + 1.05, w: cw - 0.6, h: 0.75, fontFace: BFONT, fontSize: 12, bold: true, color: NAVY2, lineSpacingMultiple: 1.03 });
    footer(s, 8);
  }

  // ============ SLIDE 9 — AI OPERATIONS LAYER ============
  {
    const s = pres.addSlide();
    s.background = { color: NAVY };
    s.addShape(pres.shapes.OVAL, { x: 10.2, y: -2, w: 6, h: 6, fill: { color: TEAL, transparency: 84 }, line: { type: "none" } });
    s.addText("AI OPERATIONS LAYER", { x: 0.9, y: 0.65, w: 11, h: 0.4, fontFace: BFONT, fontSize: 13, bold: true, color: TEALLT, charSpacing: 3 });
    s.addText("AI that works your funnel — with your choice of engine", {
      x: 0.88, y: 1.05, w: 11.5, h: 0.9, fontFace: HFONT, fontSize: 30, bold: true, color: WHITE
    });
    s.addText("A pluggable provider layer means you're never locked in. Bring Anthropic Claude, OpenAI, or Google Gemini — selected and key-managed per business.", {
      x: 0.9, y: 1.95, w: 11.2, h: 0.7, fontFace: BFONT, fontSize: 14.5, color: "C6D6E4", lineSpacingMultiple: 1.12
    });

    const uses = [
      { i: "robot", t: "Spam classification" }, { i: "layers", t: "Field-map proposals" },
      { i: "globe", t: "Language detection" }, { i: "route", t: "Department resolution" },
      { i: "map", t: "Tour matching" }, { i: "star", t: "Waitlist drafting" },
    ];
    const cw = 3.75, ch = 1.15, gx = 0.28, gy = 0.28, x0 = 0.9, y0 = 2.95;
    for (let k = 0; k < uses.length; k++) {
      const col = k % 3, row = Math.floor(k / 3);
      const x = x0 + col * (cw + gx), y = y0 + row * (ch + gy);
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w: cw, h: ch, fill: { color: NAVY2 }, line: { color: "1C3A55", width: 1 }, rectRadius: 0.08 });
      s.addShape(pres.shapes.OVAL, { x: x + 0.25, y: y + 0.28, w: 0.6, h: 0.6, fill: { color: "0F3450" }, line: { type: "none" } });
      s.addImage({ data: await ic(uses[k].i, "#5EEAD4"), x: x + 0.4, y: y + 0.43, w: 0.3, h: 0.3 });
      s.addText(uses[k].t, { x: x + 1.05, y, w: cw - 1.25, h: ch, fontFace: BFONT, fontSize: 14, bold: true, color: WHITE, valign: "middle" });
    }
    // provider chips
    s.addText("WORKS WITH", { x: 0.9, y: 6.05, w: 2.2, h: 0.4, fontFace: BFONT, fontSize: 11, bold: true, color: "8AA1B5", charSpacing: 2, valign: "middle" });
    const provs = ["Anthropic Claude", "OpenAI", "Google Gemini"];
    let px = 2.9;
    for (const p of provs) {
      const w = 0.35 + p.length * 0.11;
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: px, y: 6.02, w, h: 0.45, fill: { color: "0F3450" }, line: { color: TEAL, width: 1 }, rectRadius: 0.22 });
      s.addText(p, { x: px, y: 6.02, w, h: 0.45, fontFace: BFONT, fontSize: 12, bold: true, color: TEALLT, align: "center", valign: "middle" });
      px += w + 0.3;
    }
  }

  // ============ SLIDE 10 — ENTERPRISE / TECH ============
  {
    const s = pres.addSlide();
    s.background = { color: LIGHT };
    head(s, "Built to scale", "Enterprise-grade under the hood");

    const pillars = [
      { i: "sitemap", t: "True multi-tenant", d: "Every query auto tenant-scoped at the ORM layer. One deployment, isolated data." },
      { i: "lock", t: "Secure by design", d: "Role-gated writes, encrypted API keys, secrets never returned or logged, HTTPS + CSP/HSTS." },
      { i: "usersCog", t: "Role-based access", d: "Super Admin · Company Admin · Dept Manager · Agent · Viewer, each scoped correctly." },
      { i: "plug", t: "Webhook-first", d: "New channel = configuration, not code. Idempotent ingestion, no duplicate leads." },
    ];
    const cw = 5.75, ch = 1.75, gx = 0.6, gy = 0.3, x0 = 0.6, y0 = 1.95;
    for (let k = 0; k < pillars.length; k++) {
      const col = k % 2, row = Math.floor(k / 2);
      const x = x0 + col * (cw + gx), y = y0 + row * (ch + gy);
      s.addShape(pres.shapes.RECTANGLE, { x, y, w: cw, h: ch, fill: { color: CARD }, line: { color: LINE, width: 1 }, shadow: shadow() });
      s.addShape(pres.shapes.OVAL, { x: x + 0.32, y: y + 0.38, w: 0.72, h: 0.72, fill: { color: "E7FBF7" }, line: { type: "none" } });
      s.addImage({ data: await ic(pillars[k].i, "#0FB5A6"), x: x + 0.5, y: y + 0.56, w: 0.36, h: 0.36 });
      s.addText(pillars[k].t, { x: x + 1.3, y: y + 0.32, w: cw - 1.55, h: 0.5, fontFace: HFONT, fontSize: 17, bold: true, color: INK, valign: "middle" });
      s.addText(pillars[k].d, { x: x + 1.3, y: y + 0.82, w: cw - 1.55, h: 0.85, fontFace: BFONT, fontSize: 12.5, color: MUTED, lineSpacingMultiple: 1.05 });
    }
    // tech strip
    s.addShape(pres.shapes.RECTANGLE, { x: 0.6, y: 5.85, w: 12.15, h: 0.9, fill: { color: NAVY }, line: { type: "none" } });
    s.addText("STACK", { x: 0.85, y: 5.85, w: 1.3, h: 0.9, fontFace: BFONT, fontSize: 12, bold: true, color: GOLD, charSpacing: 2, valign: "middle" });
    s.addText("Next.js 15 · React 19 · TypeScript · PostgreSQL 16 + Prisma · Redis · Docker · 100+ integration tests", {
      x: 2.0, y: 5.85, w: 10.6, h: 0.9, fontFace: BFONT, fontSize: 13.5, color: "D8E4EE", valign: "middle"
    });
    footer(s, 10);
  }

  // ============ SLIDE 11 — DEPLOYMENT TIMELINE ============
  {
    const s = pres.addSlide();
    s.background = { color: LIGHT };
    head(s, "How we get you live", "From kickoff to go-live in 3 weeks");

    const wk = [
      { w: "WEEK 1", i: "cogs", t: "Discovery & setup", pts: ["Org structure, departments & roles mapped", "Hosting provisioned, database initialized", "Your branding applied · tour catalog imported"] },
      { w: "WEEK 2", i: "plug", t: "Integrations & AI", pts: ["Meta, WhatsApp & Google Forms live in staging", "AI provider configured, scoring & spam tuned", "Assignment strategy installed · E2E test passing"] },
      { w: "WEEK 3", i: "rocket", t: "UAT, training & go-live", pts: ["UAT sign-off with your team", "Admin & agent training (recorded)", "Production cutover + 1 week priority hypercare"] },
    ];
    const cw = 3.95, gx = 0.22, x0 = 0.6, y = 2.05, h = 4.35;
    for (let k = 0; k < wk.length; k++) {
      const x = x0 + k * (cw + gx);
      s.addShape(pres.shapes.RECTANGLE, { x, y, w: cw, h, fill: { color: CARD }, line: { color: LINE, width: 1 }, shadow: shadow() });
      s.addShape(pres.shapes.RECTANGLE, { x, y, w: cw, h: 0.85, fill: { color: NAVY }, line: { type: "none" } });
      s.addImage({ data: await ic(wk[k].i, "#5EEAD4"), x: x + 0.35, y: y + 0.24, w: 0.38, h: 0.38 });
      s.addText(wk[k].w, { x: x + 0.9, y, w: cw - 1, h: 0.85, fontFace: BFONT, fontSize: 15, bold: true, color: GOLD, charSpacing: 2, valign: "middle" });
      s.addText(wk[k].t, { x: x + 0.32, y: y + 1.02, w: cw - 0.6, h: 0.55, fontFace: HFONT, fontSize: 18, bold: true, color: INK });
      let py = y + 1.75;
      for (const p of wk[k].pts) {
        s.addImage({ data: await ic("check", "#0FB5A6"), x: x + 0.35, y: py + 0.02, w: 0.28, h: 0.28 });
        s.addText(p, { x: x + 0.75, y: py - 0.06, w: cw - 1.05, h: 0.65, fontFace: BFONT, fontSize: 12, color: INK, valign: "top", lineSpacingMultiple: 1.0 });
        py += 0.78;
      }
    }
    footer(s, 11);
  }

  // ============ SLIDE 12 — INVESTMENT ============
  {
    const s = pres.addSlide();
    s.background = { color: LIGHT };
    head(s, "The engagement", "One fixed price. Fully deployed & branded.");

    // big price panel
    const px = 0.6, py = 1.95, pw = 5.0, ph = 4.55;
    s.addShape(pres.shapes.RECTANGLE, { x: px, y: py, w: pw, h: ph, fill: { color: NAVY }, line: { type: "none" }, shadow: shadow() });
    s.addShape(pres.shapes.RECTANGLE, { x: px, y: py, w: pw, h: 0.12, fill: { color: GOLD }, line: { type: "none" } });
    s.addText("FIXED, ALL-INCLUSIVE", { x: px + 0.45, y: py + 0.5, w: pw - 0.9, h: 0.4, fontFace: BFONT, fontSize: 12, bold: true, color: TEALLT, charSpacing: 2 });
    s.addText("₹7,00,000", { x: px + 0.4, y: py + 0.95, w: pw - 0.8, h: 1.15, fontFace: HFONT, fontSize: 60, bold: true, color: WHITE });
    s.addText("Deployment · configuration · integrations · training · go-live", { x: px + 0.45, y: py + 2.15, w: pw - 0.9, h: 0.7, fontFace: BFONT, fontSize: 13.5, color: "C6D6E4", lineSpacingMultiple: 1.12 });
    // milestones
    const ms = [["Mobilization", "40%"], ["Staging demo accepted", "40%"], ["Go-live + hypercare", "20%"]];
    let my = py + 3.05;
    for (const m of ms) {
      s.addText(m[0], { x: px + 0.45, y: my, w: pw - 1.5, h: 0.35, fontFace: BFONT, fontSize: 12.5, color: WHITE, valign: "middle" });
      s.addText(m[1], { x: px + pw - 1.3, y: my, w: 0.85, h: 0.35, fontFace: BFONT, fontSize: 13, bold: true, color: GOLD, align: "right", valign: "middle" });
      my += 0.45;
    }

    // includes list
    const lx = 6.05, ly = 1.95;
    s.addText("WHAT'S INCLUDED", { x: lx, y: ly, w: 6.5, h: 0.4, fontFace: BFONT, fontSize: 12.5, bold: true, color: TEAL, charSpacing: 2 });
    const inc = [
      "Tenant provisioning — departments, stages, roles, users",
      "All channel integrations — Meta, WhatsApp, Google Forms, webhooks",
      "AI configured — provider, scoring weights, spam thresholds",
      "Bulk import of your tour catalog & capacity",
      "Assignment strategy installed & tuned to your roster",
      "Your logo, colours & custom domain with SSL",
      "Production deployment on your host or ours",
      "2 live training sessions (recorded) + 1 week hypercare",
    ];
    let iy = ly + 0.5;
    for (const it of inc) {
      s.addImage({ data: await ic("check", "#0FB5A6"), x: lx, y: iy + 0.02, w: 0.3, h: 0.3 });
      s.addText(it, { x: lx + 0.45, y: iy - 0.04, w: 6.2, h: 0.42, fontFace: BFONT, fontSize: 12.5, color: INK, valign: "middle" });
      iy += 0.555;
    }
    footer(s, 12);
  }

  // ============ SLIDE 13 — CLOSING CTA ============
  {
    const s = pres.addSlide();
    s.background = { color: NAVY };
    s.addShape(pres.shapes.OVAL, { x: 9.6, y: -2.4, w: 7, h: 7, fill: { color: TEAL, transparency: 82 }, line: { type: "none" } });
    s.addShape(pres.shapes.OVAL, { x: -2.2, y: 4.4, w: 6, h: 6, fill: { color: GOLD, transparency: 88 }, line: { type: "none" } });
    s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 0.22, h: PH, fill: { color: GOLD }, line: { type: "none" } });

    s.addImage({ data: await ic("map", "#" + TEALLT), x: 0.95, y: 0.85, w: 0.5, h: 0.5 });
    s.addText("VACAYCRM", { x: 1.55, y: 0.82, w: 6, h: 0.55, fontFace: HFONT, fontSize: 20, bold: true, color: WHITE, charSpacing: 2, valign: "middle" });

    s.addText("Stop losing bookings\nto a slow inbox.", {
      x: 0.95, y: 2.25, w: 11, h: 1.9, fontFace: HFONT, fontSize: 46, bold: true, color: WHITE, lineSpacingMultiple: 1.0
    });
    s.addText("Give us your channels, your tours and your team. In three weeks you'll have every enquiry in one pipeline, routed and worked automatically — branded as your own.", {
      x: 1.0, y: 4.25, w: 8.8, h: 1.1, fontFace: BFONT, fontSize: 16, color: TEALLT, lineSpacingMultiple: 1.15
    });

    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 1.0, y: 5.7, w: 3.5, h: 0.72, fill: { color: GOLD }, rectRadius: 0.36, line: { type: "none" } });
    s.addText("Book a live demo", { x: 1.0, y: 5.7, w: 3.5, h: 0.72, fontFace: BFONT, fontSize: 15, bold: true, color: NAVY2, align: "center", valign: "middle" });

    s.addText([
      { text: "vacaycrm.app", options: { bold: true, color: WHITE, breakLine: true } },
      { text: "Let's fill your pipeline.", options: { color: TEALLT } }
    ], { x: 4.85, y: 5.7, w: 6, h: 0.72, fontFace: BFONT, fontSize: 13.5, valign: "middle", lineSpacingMultiple: 1.05 });
  }

  await pres.writeFile({ fileName: "VacayCRM-Pitch-Deck.pptx" });
  console.log("WROTE VacayCRM-Pitch-Deck.pptx");
}
build().catch(e => { console.error(e); process.exit(1); });
