/**
 * Idempotent seed script for Holiday Delight CRM first-time setup.
 *
 * Creates:
 *  - Super Admin user (from SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD env vars)
 *  - Default "Holiday Delight" tenant
 *  - 5 departments
 *  - 8 global pipeline stages
 *  - 2 default follow-up rules
 *  - Canned responses (3-5 per department)
 *  - Default dashboard widget layout for the admin user
 *
 * Safe to run multiple times — checks for existing records before inserting.
 *
 * Usage:  npx tsx scripts/seed.ts
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function env(key: string): string {
  const val = process.env[key];
  if (!val) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return val;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// ---------------------------------------------------------------------------
// Data definitions
// ---------------------------------------------------------------------------

const TENANT_NAME = "Holiday Delight";
const TENANT_SLUG = "holiday-delight";

const DEPARTMENTS = [
  { name: "HD Visas", icon: "passport", color: "#FF6B35" },
  { name: "B2B Chardham", icon: "mountain", color: "#4CAF50" },
  { name: "Hindu Tours", icon: "temple", color: "#FF9F1C" },
  { name: "Hyderabad DMC", icon: "building", color: "#2196F3" },
  { name: "Holiday Delight", icon: "plane", color: "#9C27B0" },
] as const;

const PIPELINE_STAGES = [
  { name: "New", position: 0, color: "#6B7280", isDefault: true, isSystem: true },
  { name: "Contacted", position: 1, color: "#3B82F6", isDefault: false, isSystem: true },
  { name: "Follow-up", position: 2, color: "#F59E0B", isDefault: false, isSystem: true },
  { name: "Quotation Sent", position: 3, color: "#8B5CF6", isDefault: false, isSystem: true },
  { name: "Negotiation", position: 4, color: "#EC4899", isDefault: false, isSystem: true },
  { name: "Converted", position: 5, color: "#10B981", isDefault: false, isSystem: true },
  { name: "Lost", position: 6, color: "#EF4444", isDefault: false, isSystem: true },
  { name: "Dormant", position: 7, color: "#9CA3AF", isDefault: false, isSystem: true },
] as const;

const FOLLOW_UP_RULES = [
  {
    name: "Quotation Sent — 1-day reminder",
    triggerType: "STAGE_CHANGE" as const,
    triggerValue: "quotation-sent",
    followUpType: "REMINDER" as const,
    delayHours: 24,
    messageTemplate: "Follow up on quotation sent to the customer.",
  },
  {
    name: "Payment pending — 2-day reminder",
    triggerType: "STAGE_CHANGE" as const,
    triggerValue: "negotiation",
    followUpType: "PAYMENT" as const,
    delayHours: 48,
    messageTemplate: "Reminder: payment is pending for this lead.",
  },
];

/**
 * Canned responses keyed by department slug.
 * Each entry: { title, content, shortcut }
 */
const CANNED_RESPONSES: Record<string, { title: string; content: string; shortcut: string }[]> = {
  "hd-visas": [
    { title: "Greeting", content: "Hello! Thank you for reaching out to HD Visas. How can we assist you with your visa application today?", shortcut: "/greet" },
    { title: "Document Checklist", content: "For your visa application, please prepare the following documents:\n- Valid passport (6+ months validity)\n- Recent passport-size photographs\n- Bank statements (last 6 months)\n- Travel itinerary\n- Hotel booking confirmation", shortcut: "/docs" },
    { title: "Pricing Inquiry", content: "Our visa processing fees vary by destination and visa type. I'll prepare a detailed quotation for you shortly. Could you please confirm your destination and travel dates?", shortcut: "/price" },
    { title: "Processing Time", content: "Standard visa processing takes 5-15 business days depending on the destination country. We also offer express processing for select destinations at an additional fee.", shortcut: "/time" },
  ],
  "b2b-chardham": [
    { title: "Greeting", content: "Namaste! Welcome to B2B Chardham. We specialize in Chardham Yatra packages for travel agents and tour operators.", shortcut: "/greet" },
    { title: "Package Inquiry", content: "We offer customizable Chardham Yatra packages including helicopter and road options. Could you share the group size and preferred travel dates so I can prepare a quote?", shortcut: "/pkg" },
    { title: "B2B Rates", content: "Our B2B partner rates include special discounts on group bookings. I'll share our latest rate card with you. How many pax are you looking at?", shortcut: "/rates" },
  ],
  "hindu-tours": [
    { title: "Greeting", content: "Namaste! Thank you for contacting Hindu Tours. We curate spiritual journeys to India's most sacred destinations.", shortcut: "/greet" },
    { title: "Tour Options", content: "We offer pilgrimage tours to Varanasi, Tirupati, Rameswaram, Puri, and many more sacred destinations. Would you like me to share our upcoming tour calendar?", shortcut: "/tours" },
    { title: "Custom Pilgrimage", content: "We can create a personalized pilgrimage itinerary for your group. Please share your preferred destinations, travel dates, and group size.", shortcut: "/custom" },
    { title: "Document Request", content: "To proceed with your booking, we'll need:\n- ID proof for all travelers\n- Contact details\n- Any dietary or accessibility requirements", shortcut: "/docs" },
  ],
  "hyderabad-dmc": [
    { title: "Greeting", content: "Welcome to Hyderabad DMC! We are your local destination management partner for Hyderabad and Telangana.", shortcut: "/greet" },
    { title: "DMC Services", content: "Our DMC services include hotel bookings, local transport, guided tours, event management, and MICE solutions across Hyderabad and Telangana.", shortcut: "/services" },
    { title: "Pricing Inquiry", content: "I'd be happy to provide a quotation. Could you share the number of guests, dates, and specific services required (accommodation, transport, sightseeing)?", shortcut: "/price" },
    { title: "Popular Itineraries", content: "Our popular Hyderabad packages include:\n- Heritage Walk (Charminar, Golconda Fort)\n- Ramoji Film City day trip\n- Nagarjuna Sagar weekend getaway\n- Corporate MICE packages", shortcut: "/itin" },
  ],
  "holiday-delight": [
    { title: "Greeting", content: "Hello! Welcome to Holiday Delight. We craft unforgettable travel experiences to destinations worldwide. How can I help you plan your next holiday?", shortcut: "/greet" },
    { title: "Pricing Inquiry", content: "I'd love to help you with a quote! Could you please share your preferred destination, travel dates, number of travelers, and any special requirements?", shortcut: "/price" },
    { title: "Document Request", content: "To finalize your booking, please share:\n- Passport copies for all travelers\n- Preferred room type\n- Any dietary restrictions or special requests", shortcut: "/docs" },
    { title: "Payment Details", content: "We accept payments via bank transfer, UPI, and credit/debit cards. I'll share our payment details along with the invoice. A 30% advance is required to confirm the booking.", shortcut: "/pay" },
    { title: "Thank You", content: "Thank you for choosing Holiday Delight! We're excited to help you plan this trip. I'll get back to you with a detailed itinerary within 24 hours.", shortcut: "/thanks" },
  ],
};

// ---------------------------------------------------------------------------
// Seed logic
// ---------------------------------------------------------------------------

async function main() {
  console.log("🌱 Starting seed...\n");

  const adminEmail = env("SUPER_ADMIN_EMAIL");
  const adminPassword = env("SUPER_ADMIN_PASSWORD");

  // 1. Tenant -----------------------------------------------------------
  let tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (tenant) {
    console.log(`✓ Tenant "${TENANT_NAME}" already exists (${tenant.id})`);
  } else {
    tenant = await prisma.tenant.create({
      data: {
        name: TENANT_NAME,
        slug: TENANT_SLUG,
        productName: "Holiday Delight CRM",
        timezone: "Asia/Kolkata",
        currency: "INR",
      },
    });
    console.log(`✓ Created tenant "${TENANT_NAME}" (${tenant.id})`);
  }

  // 2. Super Admin user -------------------------------------------------
  let adminUser = await prisma.user.findUnique({
    where: { tenantId_email: { tenantId: tenant.id, email: adminEmail } },
  });
  if (adminUser) {
    console.log(`✓ Super Admin "${adminEmail}" already exists (${adminUser.id})`);
  } else {
    const passwordHash = await bcrypt.hash(adminPassword, 12);
    adminUser = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: adminEmail,
        passwordHash,
        name: "Super Admin",
        role: "SUPER_ADMIN",
        isActive: true,
      },
    });
    console.log(`✓ Created Super Admin "${adminEmail}" (${adminUser.id})`);
  }

  // 3. Departments ------------------------------------------------------
  const deptMap: Record<string, string> = {}; // slug → id
  for (const dept of DEPARTMENTS) {
    const deptSlug = slugify(dept.name);
    let existing = await prisma.department.findUnique({
      where: { tenantId_slug: { tenantId: tenant.id, slug: deptSlug } },
    });
    if (existing) {
      deptMap[deptSlug] = existing.id;
      console.log(`✓ Department "${dept.name}" already exists`);
    } else {
      existing = await prisma.department.create({
        data: {
          tenantId: tenant.id,
          name: dept.name,
          slug: deptSlug,
          icon: dept.icon,
          color: dept.color,
          isActive: true,
        },
      });
      deptMap[deptSlug] = existing.id;
      console.log(`✓ Created department "${dept.name}"`);
    }
  }

  // 4. Pipeline stages (global, no department) --------------------------
  for (const stage of PIPELINE_STAGES) {
    const stageSlug = slugify(stage.name);
    const existing = await prisma.pipelineStage.findUnique({
      where: { tenantId_slug: { tenantId: tenant.id, slug: stageSlug } },
    });
    if (existing) {
      console.log(`✓ Pipeline stage "${stage.name}" already exists`);
    } else {
      await prisma.pipelineStage.create({
        data: {
          tenantId: tenant.id,
          name: stage.name,
          slug: stageSlug,
          color: stage.color,
          position: stage.position,
          isDefault: stage.isDefault,
          isSystem: stage.isSystem,
        },
      });
      console.log(`✓ Created pipeline stage "${stage.name}"`);
    }
  }

  // 5. Follow-up rules --------------------------------------------------
  for (const rule of FOLLOW_UP_RULES) {
    const existing = await prisma.followUpRule.findFirst({
      where: {
        tenantId: tenant.id,
        triggerType: rule.triggerType,
        triggerValue: rule.triggerValue,
        delayHours: rule.delayHours,
      },
    });
    if (existing) {
      console.log(`✓ Follow-up rule "${rule.name}" already exists`);
    } else {
      await prisma.followUpRule.create({
        data: {
          tenantId: tenant.id,
          triggerType: rule.triggerType,
          triggerValue: rule.triggerValue,
          followUpType: rule.followUpType,
          delayHours: rule.delayHours,
          messageTemplate: rule.messageTemplate,
          isActive: true,
        },
      });
      console.log(`✓ Created follow-up rule "${rule.name}"`);
    }
  }

  // 6. Canned responses -------------------------------------------------
  for (const [deptSlug, responses] of Object.entries(CANNED_RESPONSES)) {
    const deptId = deptMap[deptSlug];
    if (!deptId) {
      console.warn(`⚠ Department slug "${deptSlug}" not found, skipping canned responses`);
      continue;
    }
    for (const resp of responses) {
      const existing = await prisma.cannedResponse.findFirst({
        where: {
          tenantId: tenant.id,
          departmentId: deptId,
          shortcut: resp.shortcut,
        },
      });
      if (existing) {
        console.log(`✓ Canned response "${resp.title}" (${deptSlug}) already exists`);
      } else {
        await prisma.cannedResponse.create({
          data: {
            tenantId: tenant.id,
            departmentId: deptId,
            title: resp.title,
            content: resp.content,
            shortcut: resp.shortcut,
            createdBy: adminUser.id,
            isActive: true,
          },
        });
        console.log(`✓ Created canned response "${resp.title}" (${deptSlug})`);
      }
    }
  }

  // 7. Dashboard widgets for admin --------------------------------------
  const WIDGETS = [
    {
      widgetType: "STAT_COUNTER" as const,
      title: "Total Leads",
      dataSource: "leads_total",
      size: "SMALL" as const,
      position: { x: 0, y: 0, w: 3, h: 1 },
    },
    {
      widgetType: "STAT_COUNTER" as const,
      title: "Follow-ups Due",
      dataSource: "follow_ups_due",
      size: "SMALL" as const,
      position: { x: 3, y: 0, w: 3, h: 1 },
    },
    {
      widgetType: "STAT_COUNTER" as const,
      title: "Conversion Rate",
      dataSource: "conversion_rate",
      size: "SMALL" as const,
      position: { x: 6, y: 0, w: 3, h: 1 },
    },
    {
      widgetType: "STAT_COUNTER" as const,
      title: "Callbacks Due",
      dataSource: "callbacks_scheduled",
      size: "SMALL" as const,
      position: { x: 9, y: 0, w: 3, h: 1 },
    },
    {
      widgetType: "LINE" as const,
      title: "Lead Trends",
      dataSource: "leads_by_date",
      size: "LARGE" as const,
      position: { x: 0, y: 1, w: 6, h: 2 },
      config: { period: "30d" },
    },
    {
      widgetType: "PIE" as const,
      title: "Department Breakdown",
      dataSource: "leads_by_department",
      size: "LARGE" as const,
      position: { x: 6, y: 1, w: 6, h: 2 },
      config: {},
    },
  ];

  const existingWidgets = await prisma.dashboardWidget.count({
    where: { tenantId: tenant.id, userId: adminUser.id },
  });

  if (existingWidgets > 0) {
    console.log(`✓ Dashboard widgets for admin already exist (${existingWidgets} widgets)`);
  } else {
    for (const w of WIDGETS) {
      await prisma.dashboardWidget.create({
        data: {
          tenantId: tenant.id,
          userId: adminUser.id,
          widgetType: w.widgetType,
          title: w.title,
          dataSource: w.dataSource,
          size: w.size,
          position: w.position,
          config: "config" in w ? w.config : undefined,
          refreshInterval: 300,
        },
      });
    }
    console.log(`✓ Created ${WIDGETS.length} dashboard widgets for admin`);
  }

  console.log("\n✅ Seed complete!");
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
