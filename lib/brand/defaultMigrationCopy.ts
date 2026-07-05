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
    guideTitle: string
    guideSteps: string[]
    upload: string
    uploadHint: string
    chooseFile: string
    parseError: string
    addBtn: string
    importing: string
    resultTitle: string
    startOver: string
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
    imported: string // rendered as "{n} imported" once a stage has data
    exportGuide: {
      title: string // rendered as "How to export from {source}"
      menuLabel: string
      clientsLabel: string
      calendarLabel: string
      feedNote: string
      fallback: string
    }
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
      existing: string
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
    guideTitle: string
    guideSteps: string[]
    upload: string
    uploadHint: string
    chooseFile: string
    reparse: string
    parseError: string
    mapTitle: string
    mapHint: string
    fields: { firstName: string; lastName: string; email: string; phone: string }
    unmapped: string
    previewTitle: string
    importBtn: string
    importing: string
    resultTitle: string
    startOver: string
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
      guideTitle: 'How to bring your menu over',
      guideSteps: [
        'In your old booking app, export your service or price list as a CSV file.',
        'Upload it below — we match each service to the catalog so names stay consistent.',
        "Review each match, set what you charge, and we'll handle prices below the minimum.",
      ],
      upload: 'Upload your service menu',
      uploadHint: 'A CSV exported from your old booking app',
      chooseFile: 'Choose CSV file',
      parseError: "We couldn't read that file. Make sure it's a CSV exported from your booking app.",
      addBtn: 'Add these services',
      importing: 'Adding…',
      resultTitle: 'Services added',
      startOver: 'Import another file',
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
      imported: 'imported',
      exportGuide: {
        title: 'How to export from',
        menuLabel: 'Service menu',
        clientsLabel: 'Clients',
        calendarLabel: 'Calendar',
        feedNote: 'Live calendar sync available — keep bookings updated automatically.',
        fallback:
          "Can't find an export? Most apps hide it under Settings, Reports, or a ••• menu — or upload a simple CSV with the columns each step shows.",
      },
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
        existing: 'Already in your book',
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
      noMessages: 'Importing never messages your clients — they stay quiet until you book them.',
      guideTitle: 'How to bring your clients over',
      guideSteps: [
        'In your old booking app, open your client or customer list and export it as a CSV file.',
        'Upload that file below. It stays in your account — nothing is shared with your old app.',
        'Match your columns to first name, last name, email, and phone.',
        'Review the list and import. Existing clients merge instead of duplicating.',
      ],
      upload: 'Upload your client list',
      uploadHint: 'A CSV exported from your old booking app',
      chooseFile: 'Choose CSV file',
      reparse: 'Choose a different file',
      parseError: "We couldn't read that file. Make sure it's a CSV exported from your booking app.",
      mapTitle: 'Match your columns',
      mapHint: 'Tell us which column is which. First and last name are required.',
      fields: { firstName: 'First name', lastName: 'Last name', email: 'Email', phone: 'Phone' },
      unmapped: 'Not in my file',
      previewTitle: 'Review your clients',
      importBtn: 'Import clients',
      importing: 'Importing…',
      resultTitle: 'Clients imported',
      startOver: 'Import another file',
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
