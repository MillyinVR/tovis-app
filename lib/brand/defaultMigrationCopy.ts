// lib/brand/defaultMigrationCopy.ts
//
// User-facing copy for the pro migration / import flow. Mirrors the pattern in
// defaultProCalendarCopy.ts — a factory that bakes the brand wordmark in so no
// component hardcodes the brand name. Lives under lib/brand/ (the brand source of
// truth), so it is exempt from the no-hardcoded-brand-strings guard; even so, we
// inject `wordmark` rather than literal-ing the name, for white-label correctness.
//
// Not yet wired into BrandConfig — consumed directly by the migrate pages for now.

export type MigrationCopy = {
  services: {
    title: string
    subtitle: string
    importedSuffix: string // rendered as "{n} services imported"
    colYours: string
    colMapped: string
    colPrice: string
    bestMatch: string
    dropdownSearch: string
    requestNew: string
    skip: string
    raise: {
      headingSuffix: string // "...are below the {brand} minimum — here's your raise plan"
      brand: string
      acceptAll: string
      tune: string
      floorNote: string
      newClients: string
      newClientsHint: string
      existingClients: string
      existingClientsHint: string
      fullyAtMin: string
      modePercent: string
      modeDollars: string
      stepLabel: string
      cadenceLabel: string
      atMinimum: string
    }
    chips: {
      raiseUnlocked: string
      needsAttention: string
      licensedOnly: string
      requestPending: string
      skipped: string
      suggested: string
    }
    notImported: string
    lockedUntilLicensed: string
    cta: string
  }
  entry: {
    hero: string
    heroSub: string
    pickLabel: string
    bringTitle: string
    cards: { clientsDesc: string; servicesDesc: string; calendarDesc: string }
    notStarted: string
    readyTitle: string
    readySub: string
    cta: string
    trust: string[]
  }
  clients: {
    title: string
    contactsSuffix: string
    search: string
    selectAll: string
    deselectAll: string
    colClient: string
    colContact: string
    colMatch: string
    colLastVisit: string
    colInclude: string
    chips: {
      autoMatched: string
      newClient: string
      possibleDupe: string
      missingInfo: string
      excluded: string
    }
    noContact: string
    dupe: {
      question: string
      merge: string
      mergeHint: string
      separate: string
      separateHint: string
    }
    noMessages: string
    cta: string
  }
  calendar: {
    title: string
    bookingsSuffix: string
    workingHours: string
    off: string
    buffer: string
    advance: string
    timeBlocks: string
    timeBlocksNote: string
    colWhen: string
    colClient: string
    colDuration: string
    colStatus: string
    colTransfer: string
    chips: { confirmed: string; pending: string; skipped: string }
    pastNoteSuffix: string
    cta: string
  }
  review: {
    title: string
    complete: string
    raiseRecapTitle: string
    editPlan: string
    preflightTitle: string
    goLiveTitle: string
    goLive: string
    trust: string[]
  }
}

export function defaultMigrationCopy(wordmark: string): MigrationCopy {
  return {
    services: {
      title: `Map your menu to ${wordmark}`,
      subtitle: `Match each of your services to a ${wordmark} service so pricing and naming stay consistent.`,
      importedSuffix: 'services imported',
      colYours: 'Your service',
      colMapped: `${wordmark} service`,
      colPrice: 'Price · duration · availability',
      bestMatch: 'Best match · Suggested',
      dropdownSearch: 'Search services',
      requestNew: 'Request new service',
      skip: "Skip — don't add",
      raise: {
        headingSuffix: `minimum — here's your raise plan`,
        brand: wordmark,
        acceptAll: 'Accept all',
        tune: 'Tune',
        floorNote:
          'Floor is 10% every 10 weeks — you can raise faster, just not gentler.',
        newClients: 'New clients pay',
        newClientsHint: 'starting today',
        existingClients: 'Existing clients start',
        existingClientsHint: 'grandfathered',
        fullyAtMin: `Fully at the ${wordmark} minimum`,
        modePercent: 'Percent',
        modeDollars: 'Dollars',
        stepLabel: 'Raise each step by',
        cadenceLabel: 'How often',
        atMinimum: 'at minimum',
      },
      chips: {
        raiseUnlocked: 'Raise unlocked',
        needsAttention: 'Needs attention',
        licensedOnly: 'Licensed pros only',
        requestPending: 'Request pending',
        skipped: 'Skipped',
        suggested: 'Suggested',
      },
      notImported: 'Not imported',
      lockedUntilLicensed: 'Locked until licensed',
      cta: 'Continue to clients',
    },
    entry: {
      hero: `Bring your business over to ${wordmark} in one guided pass.`,
      heroSub:
        'Move your clients, service menu, and calendar — you review everything before anything goes live.',
      pickLabel: 'Where are you coming from?',
      bringTitle: "What you'll bring over",
      cards: {
        clientsDesc: 'Your contacts, matched and de-duplicated.',
        servicesDesc: `Mapped to the ${wordmark} catalog so names stay clean.`,
        calendarDesc: 'Upcoming bookings and your working hours.',
      },
      notStarted: 'Not started',
      readyTitle: 'Ready when you are.',
      readySub: 'Nothing is shared with your old app — no password needed.',
      cta: 'Start with my service menu',
      trust: ['No password needed', 'You review everything', 'Nothing sent to clients'],
    },
    clients: {
      title: 'Bring your clients over',
      contactsSuffix: 'contacts found',
      search: 'Search clients',
      selectAll: 'Select all',
      deselectAll: 'Deselect all',
      colClient: 'Client',
      colContact: 'Contact',
      colMatch: 'Match',
      colLastVisit: 'Last visit',
      colInclude: 'Include',
      chips: {
        autoMatched: 'Auto-matched',
        newClient: 'New client',
        possibleDupe: 'Possible dupe',
        missingInfo: 'Missing info',
        excluded: 'Excluded',
      },
      noContact: 'No contact info',
      dupe: {
        question: 'Possible duplicate — is this the same person?',
        merge: 'Merge into existing',
        mergeHint: 'Combine into one profile',
        separate: 'Keep separate',
        separateHint: "Create a new client — they're different people",
      },
      noMessages: 'Importing never messages your clients.',
      cta: 'Continue to calendar',
    },
    calendar: {
      title: 'Move your calendar',
      bookingsSuffix: 'upcoming bookings',
      workingHours: 'Working hours',
      off: 'Off',
      buffer: 'Buffer time',
      advance: 'Advance booking window',
      timeBlocks: 'Time blocks',
      timeBlocksNote: 'Recurring blocks carry over from your export.',
      colWhen: 'Date & time',
      colClient: 'Client · service',
      colDuration: 'Duration',
      colStatus: 'Status',
      colTransfer: 'Transfer',
      chips: { confirmed: 'Confirmed', pending: 'Pending', skipped: 'Skipped' },
      pastNoteSuffix:
        'past visits also importing — these attach to client profiles, not your active calendar.',
      cta: 'Continue to review',
    },
    review: {
      title: "Everything looks good — let's go live",
      complete: 'Complete',
      raiseRecapTitle: 'Your raise plan',
      editPlan: 'Edit plan',
      preflightTitle: 'Preflight',
      goLiveTitle: `Ready to go live on ${wordmark}`,
      goLive: `Go live on ${wordmark}`,
      trust: ['Nothing sent to clients yet', 'Reversible until you go live'],
    },
  }
}
