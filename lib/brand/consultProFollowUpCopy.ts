// C2-4 — the pro-facing words on the "Ask a follow-up" control of the Brief.
//
// A plain const like consultTranscriptCopy: professional surfaces are not
// tenant-themed. Nothing here reaches a client; her side is
// defaultClientConsultThreadCopy (the card) and
// defaultClientConsultProFollowUpCopy (the doorbell).
export const consultProFollowUpCopy = {
  title: 'Ask a follow-up',
  intro:
    'One quick question, answered with a tap. She sees your name on it, in the thread she already uses, and gets a gentle notification.',
  textLabel: 'Your question',
  textPlaceholder: 'e.g. Have you had keratin or a smoothing treatment in the last year?',
  textHint: 'Up to 300 characters. Plain words — she may not know the technical term.',
  optionsLabel: 'Answers she can tap',
  optionPlaceholder: (index: number) => `Option ${index + 1}`,
  optionsHint: 'Two to six short answers. Add “Not sure” when it is a real answer.',
  addOption: 'Add an answer',
  removeOption: 'Remove',
  priorityLabel: 'How urgent',
  priority: {
    NEED_BEFORE_APPOINTMENT: {
      label: 'Needed before the appointment',
      hint: 'The answer could change safety, timing, products, or whether the plan holds.',
    },
    HELPFUL_FOR_PREP: {
      label: 'Helpful for prep',
      hint: 'Useful to know; nothing blocks on it.',
    },
  },
  submit: 'Send question',
  sending: 'Sending…',
  asked: 'Sent',
  waiting: 'Waiting for her answer',
  answered: 'Answered',
  openLimit: (max: number) => `Up to ${max} questions can be open at once. Wait for an answer before asking another.`,
  totalLimit: 'This consultation has reached its question limit.',
  failed: 'Couldn’t send that. Try again.',
  invalid: 'Add a question and at least two answers she can tap.',
  askedList: 'Questions you’ve asked',
  none: 'You haven’t asked anything yet.',
} as const
