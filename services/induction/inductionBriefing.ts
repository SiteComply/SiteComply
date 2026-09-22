/**
 * The site briefing an operative reads BEFORE the induction's acknowledgements.
 *
 * WHY THIS EXISTS. The induction asked operatives to confirm "I have received
 * and understood the site induction", "I know how to report a near miss and
 * where to find the first aider and welfare facilities" and "I have read the
 * RAMS for my work" - without showing any of it. Most of that information was
 * already held (Site information, emergency details, the construction phase
 * plan, RAMS), but it reached operatives only after check-in, or never.
 *
 * READ ONLY, AND NOTHING NEW TO CAPTURE. Every block here is data a manager has
 * already entered somewhere in the platform. A block with no content is left
 * out, a screen with no blocks is left out, and a site with no briefing content
 * at all gets exactly the induction it had before.
 *
 * PURE. composeBriefing() takes plain data and returns plain, serialisable
 * screens, so the rules are testable without a database. The loader that feeds
 * it lives in inductionBriefingService.ts.
 */

export type BriefingIcon =
  | 'alert'
  | 'building'
  | 'clipboard'
  | 'clock'
  | 'doc'
  | 'fire'
  | 'firstaid'
  | 'grid'
  | 'permit'
  | 'phone'
  | 'rams'
  | 'shield'
  | 'user';

export type BriefingTone = 'brand' | 'safe' | 'teal' | 'hivis' | 'danger';

export interface BriefingBlock {
  key: string;
  title: string;
  icon: BriefingIcon;
  tone: BriefingTone;
  /** Free text, exactly as the site team wrote it. */
  text?: string;
  /** Short labelled facts, e.g. "Emergency number: 999". */
  rows?: { label: string; value: string }[];
  /** People to know: first aiders, fire marshals, the site manager. */
  people?: { role: string; name: string; phone?: string; location?: string }[];
  /** A plain list, e.g. permit types in use. */
  list?: string[];
  /** Titled entries, e.g. a risk and its controls. A risk with no controls
   *  written still appears, by title alone - nothing is invented for it. */
  entries?: { title: string; text?: string }[];
  /** Documents to open, e.g. RAMS. */
  links?: { label: string; href: string }[];
  /** The site map. */
  image?: { src: string; alt: string };
}

export type BriefingScreenKey = 'site' | 'emergency' | 'welfare' | 'hazards';

export interface BriefingScreen {
  key: BriefingScreenKey;
  heading: string;
  intro: string;
  blocks: BriefingBlock[];
}

/** Everything the briefing can draw on. All of it already stored. */
export interface BriefingSource {
  siteId: string;
  siteName: string;
  address: string;
  jobReference: string;
  /** JobSite.inductionContent - the site team's own briefing notes. */
  inductionNotes: string | null;
  project: { description: string | null; scopeOfWorks: string | null } | null;
  duty: { principalContractor: string | null; client: string | null } | null;
  siteManager: { name: string | null; phone: string | null } | null;
  emergency: {
    fireAssemblyPoint: string | null;
    firstAiderName: string | null;
    firstAiderNumber: string | null;
    firstAiderLocation: string | null;
    nearestHospital: string | null;
    emergencyNumber: string | null;
  };
  keyPeople: { kind: string; name: string; phone: string | null; location: string | null }[];
  info: {
    workingHours: string | null;
    welfareFacilities: string | null;
    siteHazards: string | null;
    emergencyProcedures: string | null;
    existingSiteRisks: string | null;
    temporaryWorks: string | null;
    trafficManagement: string | null;
    deliveryProcedures: string | null;
    accessEgress: string | null;
    environmentalControls: string | null;
    utilitiesIsolation: string | null;
    highRiskActivities: string | null;
    fireArrangements: string | null;
    hasSiteMap: boolean;
  };
  /** The construction phase plan's incident-reporting arrangement, resolved. */
  incidentReporting: string | null;
  /** Plan risk topics marked as applying, with the controls written for them. */
  risks: { label: string; controls: string | null }[];
  /** Permit types available on this site. */
  permitTypes: string[];
  ramsDocuments: { id: string; title: string }[];
}

/** Trimmed text, or undefined when there is nothing to say. */
function t(value: string | null | undefined): string | undefined {
  const v = (value ?? '').trim();
  return v ? v : undefined;
}

function rows(pairs: [string, string | null | undefined][]) {
  const out = pairs
    .map(([label, value]) => ({ label, value: t(value) }))
    .filter((r): r is { label: string; value: string } => Boolean(r.value));
  return out.length ? out : undefined;
}

/** A block survives only if it carries something to read. */
function hasContent(b: BriefingBlock): boolean {
  return Boolean(
    b.text ||
      b.rows?.length ||
      b.people?.length ||
      b.list?.length ||
      b.entries?.length ||
      b.links?.length ||
      b.image,
  );
}

const PERSON_ROLE: Record<string, string> = {
  FIRST_AIDER: 'First aider',
  FIRE_MARSHAL: 'Fire marshal',
  SITE_MANAGER: 'Site manager',
  OTHER: 'Contact',
};

/** Paths the induction can open BEFORE check-in. See the induction routes. */
export function briefingMapSrc(siteId: string): string {
  return `/api/worker/induction/${encodeURIComponent(siteId)}/site-map`;
}
export function briefingDocumentHref(siteId: string, documentId: string): string {
  return `/api/worker/induction/${encodeURIComponent(siteId)}/documents/${encodeURIComponent(documentId)}`;
}

export function composeBriefing(src: BriefingSource): BriefingScreen[] {
  const { info, emergency } = src;

  // People: the site's key-people list, with the emergency first aider added
  // when that person is not already on it - two places hold first aiders, and
  // an operative should see each person once.
  const people = src.keyPeople
    .filter((p) => t(p.name))
    .map((p) => ({
      role: PERSON_ROLE[p.kind] ?? 'Contact',
      name: p.name.trim(),
      phone: t(p.phone),
      location: t(p.location),
    }));
  const firstAider = t(emergency.firstAiderName);
  if (
    firstAider &&
    !people.some((p) => p.name.toLowerCase() === firstAider.toLowerCase())
  ) {
    people.unshift({
      role: 'First aider',
      name: firstAider,
      phone: t(emergency.firstAiderNumber),
      location: t(emergency.firstAiderLocation),
    });
  }
  const firstAid = people.filter((p) => p.role === 'First aider' || p.role === 'Fire marshal');
  const manager = t(src.siteManager?.name);
  const siteTeam = [
    ...(manager
      ? [{ role: 'Site manager', name: manager, phone: t(src.siteManager?.phone) }]
      : []),
    ...people.filter(
      (p) =>
        (p.role === 'Site manager' || p.role === 'Contact') &&
        p.name.toLowerCase() !== (manager ?? '').toLowerCase(),
    ),
  ];

  const screens: BriefingScreen[] = [
    {
      key: 'site',
      heading: 'About this site',
      intro: 'What this project is, where it is, and who runs it.',
      blocks: [
        {
          key: 'project',
          title: 'The project',
          icon: 'building',
          tone: 'brand',
          rows: rows([
            ['Site', src.siteName],
            ['Address', src.address],
            ['Reference', src.jobReference],
            ['Principal contractor', src.duty?.principalContractor],
            ['Client', src.duty?.client],
          ]),
        },
        { key: 'description', title: 'About the work', icon: 'clipboard', tone: 'brand',
          text: [t(src.project?.description), t(src.project?.scopeOfWorks)].filter(Boolean).join('\n\n') || undefined },
        { key: 'notes', title: 'From the site team', icon: 'user', tone: 'brand', text: t(src.inductionNotes) },
        { key: 'hours', title: 'Working hours', icon: 'clock', tone: 'brand', text: t(info.workingHours) },
        { key: 'team', title: 'Site team', icon: 'user', tone: 'brand',
          people: siteTeam.length ? siteTeam : undefined },
      ],
    },
    {
      key: 'emergency',
      heading: 'Emergencies and first aid',
      intro: 'What to do if something goes wrong, and who can help.',
      blocks: [
        { key: 'procedures', title: 'Emergency procedures', icon: 'alert', tone: 'danger', text: t(info.emergencyProcedures) },
        { key: 'fire', title: 'Fire', icon: 'fire', tone: 'hivis', text: t(info.fireArrangements),
          rows: rows([['Assembly point', emergency.fireAssemblyPoint]]) },
        { key: 'contacts', title: 'Emergency contacts', icon: 'phone', tone: 'danger',
          rows: rows([
            ['Emergency number', emergency.emergencyNumber],
            ['Nearest hospital', emergency.nearestHospital],
          ]) },
        { key: 'firstaid', title: 'First aid', icon: 'firstaid', tone: 'safe',
          people: firstAid.length ? firstAid : undefined },
        { key: 'reporting', title: 'Reporting accidents and near misses', icon: 'clipboard', tone: 'brand',
          text: t(src.incidentReporting) },
      ],
    },
    {
      key: 'welfare',
      heading: 'Welfare, access and traffic',
      intro: 'Facilities, how to get on and off site, and vehicle and pedestrian movements.',
      blocks: [
        { key: 'welfare', title: 'Welfare facilities', icon: 'shield', tone: 'teal', text: t(info.welfareFacilities) },
        { key: 'access', title: 'Access and egress', icon: 'grid', tone: 'brand', text: t(info.accessEgress) },
        { key: 'deliveries', title: 'Deliveries', icon: 'grid', tone: 'brand', text: t(info.deliveryProcedures) },
        { key: 'traffic', title: 'Traffic management and pedestrian routes', icon: 'alert', tone: 'hivis', text: t(info.trafficManagement) },
        { key: 'map', title: 'Site map', icon: 'doc', tone: 'brand',
          image: info.hasSiteMap ? { src: briefingMapSrc(src.siteId), alt: `Site map for ${src.siteName}` } : undefined },
      ],
    },
    {
      key: 'hazards',
      heading: 'Hazards and controls',
      intro: 'The risks on this site and how they are controlled.',
      blocks: [
        { key: 'hazards', title: 'Site-specific hazards', icon: 'alert', tone: 'hivis', text: t(info.siteHazards) },
        { key: 'existing', title: 'Existing site risks', icon: 'alert', tone: 'hivis', text: t(info.existingSiteRisks) },
        { key: 'highrisk', title: 'High-risk activities', icon: 'alert', tone: 'danger', text: t(info.highRiskActivities) },
        { key: 'permits', title: 'Work that needs a permit here', icon: 'permit', tone: 'brand',
          list: src.permitTypes.length ? src.permitTypes : undefined },
        { key: 'temporary', title: 'Temporary works', icon: 'building', tone: 'brand', text: t(info.temporaryWorks) },
        { key: 'utilities', title: 'Services and isolation', icon: 'alert', tone: 'hivis', text: t(info.utilitiesIsolation) },
        { key: 'environment', title: 'Environmental controls', icon: 'shield', tone: 'teal', text: t(info.environmentalControls) },
        { key: 'risks', title: 'Significant risks and their controls', icon: 'shield', tone: 'safe',
          entries: (() => {
            const e = src.risks
              .filter((r) => t(r.label))
              .map((r) => ({ title: r.label.trim(), text: t(r.controls) }));
            return e.length ? e : undefined;
          })() },
        { key: 'rams', title: 'Risk assessments and method statements (RAMS)', icon: 'rams', tone: 'brand',
          links: src.ramsDocuments.length
            ? src.ramsDocuments.map((d) => ({ label: d.title, href: briefingDocumentHref(src.siteId, d.id) }))
            : undefined },
      ],
    },
  ];

  return screens
    .map((s) => ({ ...s, blocks: s.blocks.filter(hasContent) }))
    // A screen made only of the identity rows every site has (name, address,
    // reference) is not a briefing - it is what the previous page already said.
    .filter((s) =>
      s.key === 'site'
        ? s.blocks.some((b) => b.key !== 'project') || Boolean(src.duty?.principalContractor || src.duty?.client)
        : s.blocks.length > 0,
    );
}
