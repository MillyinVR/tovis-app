import type { BrandClientConsultInspirationCopy } from './types'

// P5c — every sentence the guided-inspiration step says, in one file.
//
// These four were literals inside lib/consult/inspirationPack.ts, which is
// also where the hair-colour question list lived. Splitting them out is what
// lets a second service family ask its own questions without inheriting hair's
// words, and it is the white-label rule: user-facing copy comes from
// lib/brand, never from a contract module.
//
// The sentences are UNCHANGED from the ones the step has been showing since
// C10 — this move is not a re-write. The voice is the app's: it explains what
// a reference picture is FOR and, quietly, what it is not.
//
// P5d added `cards`: the words on the inspiration CARDS, keyed by attribute
// and value. See BrandClientConsultInspirationCardCopy in ./types for the
// contract; the short version is that a card's crop comes from the reading and
// its words come from here, so nothing a client sees is stored in her payload.
export const defaultClientConsultInspirationCopy: BrandClientConsultInspirationCopy =
  {
    introduction:
      'An inspiration picture is optional. It can help you and your professional get visually on the same page.',

    // 🔴 Load-bearing, not decoration. A photograph of someone else's hair is
    // the single easiest place for a client to hear a promise that nobody
    // made, so the step says so in her own view, every time.
    referenceNote:
      'Use it as a reference, not a guarantee or something that can be copied directly onto you.',

    reflectionPromptHair:
      'A complete look can include color, length, fullness, and styling. Take a moment to choose what actually stands out to you.',
    reflectionPrompt:
      'A picture can be about several things at once. Take a moment to choose what actually stands out to you.',

    // Shown when a detail she picked out may be a service of its own. It says
    // the thing a client actually needs to know — that nothing was added to
    // her booking behind her back — and hands the question to her
    // professional rather than answering it.
    catalogGuidanceNote:
      'This part of the complete look may involve a separate service your professional already offers. Ask what applies; nothing was added to this booking.',

    cards: {
      // A pack may word a shared question its own way by prefixing the key
      // with its pack id; the bare key is the fallback every pack gets.
      prompts: {
        'spark_focus': 'What made you stop scrolling?',
        'look_match': 'For the parts you chose, how close do you want to stay to this picture?',
        'hair-color-inspiration:keep_as_is': 'Anything about your hair you don’t want to change?',
        'hair-general-inspiration:keep_as_is': 'Anything about your hair you don’t want to change?',
        'keep_as_is': 'Anything you don’t want to change?',
        'attr_base_level': 'Is this part of what you like?',
        'attr_lightest_level': 'Is this part of what you like?',
        'attr_tone': 'Is this part of what you like?',
        'attr_technique': 'Is this part of what you like?',
        'attr_placement': 'Is this part of what you like?',
        'attr_root_blend': 'Is this part of what you like?',
        'attr_finish': 'Is this part of what you like?',
        'attr_dimension': 'Is this part of what you like?',
        // P5g — the two moves that replaced the eight cards above. Short,
        // warm, and an instruction rather than a test: she is looking at her
        // own picture with the parts already drawn on it.
        'love_regions': 'Tap what you love.',
        'change_regions': 'Anything you’d change?',
      },

      optionLabels: {
        'spark_focus:the-color': 'The color',
        'spark_focus:the-cut': 'The cut',
        'spark_focus:the-layers': 'The layers',
        'spark_focus:the-movement': 'The movement',
        'spark_focus:the-length': 'The length',
        'spark_focus:the-fullness': 'The fullness',
        'look_match:match-selected-parts': 'As close as possible, keeping what I chose to keep',
        'look_match:adapt-selected-parts': 'Make those parts work for me',
        'look_match:not-sure': 'Help me decide',
        'keep_as_is:my-color': 'My color',
        'spark_focus:the-shape': 'The shape of it',
        'spark_focus:the-whole-thing': 'The whole thing',
        'spark_focus:not-sure': 'Not sure',
        'keep_as_is:my-length': 'My length',
        'keep_as_is:my-natural-roots': 'My natural roots',
        'keep_as_is:my-natural-texture': 'My natural texture',
        'keep_as_is:my-natural-shape': 'My natural shape',
        'keep_as_is:nothing-in-particular': 'Nothing in particular',
        'understanding_check:thats-right': 'That’s right',
        'understanding_check:change-something': 'Change something',
        'attr_base_level:yes': 'Yes',
        'attr_base_level:not-this': 'Not this',
        'attr_base_level:not-sure': 'Not sure',
        'attr_lightest_level:yes': 'Yes',
        'attr_lightest_level:not-this': 'Not this',
        'attr_lightest_level:not-sure': 'Not sure',
        'attr_tone:yes': 'Yes',
        'attr_tone:not-this': 'Not this',
        'attr_tone:not-sure': 'Not sure',
        'attr_technique:yes': 'Yes',
        'attr_technique:not-this': 'Not this',
        'attr_technique:not-sure': 'Not sure',
        'attr_placement:yes': 'Yes',
        'attr_placement:not-this': 'Not this',
        'attr_placement:not-sure': 'Not sure',
        'attr_root_blend:yes': 'Yes',
        'attr_root_blend:not-this': 'Not this',
        'attr_root_blend:not-sure': 'Not sure',
        'attr_finish:yes': 'Yes',
        'attr_finish:not-this': 'Not this',
        'attr_finish:not-sure': 'Not sure',
        'attr_dimension:yes': 'Yes',
        'attr_dimension:not-this': 'Not this',
        'attr_dimension:not-sure': 'Not sure',
        // 🔴 Only the NEUTRAL values of the region cards are here. Every other
        // option is labelled from the reading itself ("cool, silvery cast"),
        // because a region's name is a description of THIS photograph and a
        // fixed label would be the static list P5g exists to remove.
        'love_regions:not-sure': 'Not sure yet',
        'change_regions:nothing-to-change': 'Nothing — I’d keep all of it',
      },

      // 🔴 Shown AFTER the crop, never before it. Each one names the thing she
      // is already looking at and, where there is a salon word for it, offers
      // it as something "some people call it" rather than as the word she was
      // supposed to already know.
      attributeNames: {
        'baseLevel:LEVEL_1': 'This is where the color starts, up at the roots — just about black.',
        'baseLevel:LEVEL_2':
          'This is where the color starts, up at the roots — a very dark brown, nearly black.',
        'baseLevel:LEVEL_3': 'This is where the color starts, up at the roots — a dark brown.',
        'baseLevel:LEVEL_4':
          'This is where the color starts, up at the roots — a medium-dark brown.',
        'baseLevel:LEVEL_5': 'This is where the color starts, up at the roots — a medium brown.',
        'baseLevel:LEVEL_6': 'This is where the color starts, up at the roots — a light brown.',
        'baseLevel:LEVEL_7':
          'This is where the color starts, up at the roots — a dark blonde, right where brown turns blonde.',
        'baseLevel:LEVEL_8': 'This is where the color starts, up at the roots — a medium blonde.',
        'baseLevel:LEVEL_9': 'This is where the color starts, up at the roots — a light blonde.',
        'baseLevel:LEVEL_10':
          'This is where the color starts, up at the roots — the palest blonde there is.',
        'lightestLevel:LEVEL_1': 'This is the lightest it gets — just about black.',
        'lightestLevel:LEVEL_2': 'This is the lightest it gets — a very dark brown, nearly black.',
        'lightestLevel:LEVEL_3': 'This is the lightest it gets — a dark brown.',
        'lightestLevel:LEVEL_4': 'This is the lightest it gets — a medium-dark brown.',
        'lightestLevel:LEVEL_5': 'This is the lightest it gets — a medium brown.',
        'lightestLevel:LEVEL_6': 'This is the lightest it gets — a light brown.',
        'lightestLevel:LEVEL_7':
          'This is the lightest it gets — a dark blonde, right where brown turns blonde.',
        'lightestLevel:LEVEL_8': 'This is the lightest it gets — a medium blonde.',
        'lightestLevel:LEVEL_9': 'This is the lightest it gets — a light blonde.',
        'lightestLevel:LEVEL_10': 'This is the lightest it gets — the palest blonde there is.',
        'tone:WARM':
          'This is the warmth in it — the golden, honey side of the color. Some people call it warm.',
        'tone:COOL': 'This is the cooler, silvery cast in it — some people call it ash.',
        'tone:NEUTRAL':
          'This one sits in the middle, neither golden nor silvery. Some people call it neutral.',
        'technique:SINGLE_PROCESS':
          'This is one color all the way through, rather than pieces of light and dark.',
        'technique:BALAYAGE':
          'This is color painted on in soft sweeps, so it grows out gently. Some people call it balayage.',
        'technique:FOIL_HIGHLIGHTS':
          'These are lighter pieces placed all through it. Some people call them highlights.',
        'technique:BABYLIGHTS':
          'These are very fine lighter pieces, softer than ordinary highlights. Some people call them babylights.',
        'technique:LOWLIGHTS':
          'These are darker pieces woven back in for depth. Some people call them lowlights.',
        'technique:COLOR_MELT':
          'This is one shade blended into the next with no line between them. Some people call it a melt.',
        'technique:GLOSS_ONLY':
          'This is a shine treatment sitting over the color that is already there. Some people call it a gloss.',
        'technique:DOUBLE_PROCESS':
          'This is hair lightened first and then toned — two steps rather than one.',
        'technique:NATURAL_UNCOLORED': 'This looks like hair that has not been colored at all.',
        'placement:ALL_OVER': 'This runs everywhere, roots to ends.',
        'placement:FACE_FRAMING': 'This sits in the pieces at the very front.',
        'placement:MIDS_TO_ENDS': 'This starts partway down and carries on to the ends.',
        'placement:ENDS_ONLY': 'This is only in the ends.',
        'placement:SURFACE_ONLY': 'This sits on the top layer, where the light hits it.',
        'placement:UNDERNEATH': 'This is tucked underneath, so it shows when the hair moves.',
        'placement:PANELS': 'These are wider sections rather than fine pieces.',
        'rootBlend:SOLID_TO_ROOT':
          'The color goes right up to the roots, with nothing darker left behind.',
        'rootBlend:SHADOW_ROOT':
          'The roots are left a little darker on purpose, so it grows out softly.',
        'rootBlend:SEAMLESS_MELT': 'There is no line at the roots at all — it just fades.',
        'rootBlend:GROWN_OUT': 'The roots have grown out, and it is being worn that way.',
        'finish:HIGH_SHINE': 'This is how much it shines — glassy.',
        'finish:SATIN': 'This is how much it shines — soft, not glassy.',
        'finish:MATTE': 'This is how much it shines — barely at all.',
        'dimension:FLAT':
          'This is how much light and dark it has — one even color, all the way through.',
        'dimension:SUBTLE': 'This is how much light and dark it has — just a little movement.',
        'dimension:MEDIUM': 'This is how much light and dark it has — a clear mix of the two.',
        'dimension:HIGH_CONTRAST':
          'This is how much light and dark it has — a strong difference between them.',
      },

      // P5g — where SHE is starting from, said one way and reused verbatim by
      // every round of a plan. "your light brown, golden base".
      startingPoint: {
        toneNames: {
          ASHY: 'ashy',
          NEUTRAL: 'neutral',
          GOLDEN: 'golden',
          COPPER: 'coppery',
          RED: 'red',
          MIXED: 'mixed',
        },
        withLevelAndTone: 'your {level}, {tone} base',
        levelOnly: 'your {level} base',
        toneOnly: 'your {tone} base',
      },

      // P5g — what a tappable region is called when the reading's own short
      // name is missing. Names the attribute, never the reading: vaguer than
      // "cool, silvery cast" and never wrong about the picture.
      attributeFallbackNames: {
        baseLevel: 'where the color starts',
        lightestLevel: 'how light it gets',
        tone: 'the warmth of it',
        technique: 'how it was done',
        placement: 'where the color sits',
        rootBlend: 'what the roots do',
        finish: 'how much it shines',
        dimension: 'the light and dark in it',
      },

      // The same readings as a noun phrase, for dropping inside a sentence.
      attributeShortNames: {
        'baseLevel:LEVEL_1': 'near-black',
        'baseLevel:LEVEL_2': 'very dark brown',
        'baseLevel:LEVEL_3': 'dark brown',
        'baseLevel:LEVEL_4': 'medium-dark brown',
        'baseLevel:LEVEL_5': 'medium brown',
        'baseLevel:LEVEL_6': 'light brown',
        'baseLevel:LEVEL_7': 'dark blonde',
        'baseLevel:LEVEL_8': 'medium blonde',
        'baseLevel:LEVEL_9': 'light blonde',
        'baseLevel:LEVEL_10': 'palest blonde',
        'lightestLevel:LEVEL_1': 'near-black',
        'lightestLevel:LEVEL_2': 'very dark brown',
        'lightestLevel:LEVEL_3': 'dark brown',
        'lightestLevel:LEVEL_4': 'medium-dark brown',
        'lightestLevel:LEVEL_5': 'medium brown',
        'lightestLevel:LEVEL_6': 'light brown',
        'lightestLevel:LEVEL_7': 'dark blonde',
        'lightestLevel:LEVEL_8': 'medium blonde',
        'lightestLevel:LEVEL_9': 'light blonde',
        'lightestLevel:LEVEL_10': 'palest blonde',
        'tone:WARM': 'warmth in it',
        'tone:COOL': 'cool, silvery cast',
        'tone:NEUTRAL': 'even, in-between tone',
        'technique:SINGLE_PROCESS': 'one solid color',
        'technique:BALAYAGE': 'painted-on sweeps',
        'technique:FOIL_HIGHLIGHTS': 'lighter pieces',
        'technique:BABYLIGHTS': 'very fine light pieces',
        'technique:LOWLIGHTS': 'darker pieces woven in',
        'technique:COLOR_MELT': 'shade-into-shade blend',
        'technique:GLOSS_ONLY': 'shine over your own color',
        'technique:DOUBLE_PROCESS': 'lightened-then-toned color',
        'technique:NATURAL_UNCOLORED': 'uncolored look of it',
        'placement:ALL_OVER': 'color everywhere',
        'placement:FACE_FRAMING': 'pieces at the front',
        'placement:MIDS_TO_ENDS': 'color from partway down',
        'placement:ENDS_ONLY': 'color in the ends',
        'placement:SURFACE_ONLY': 'color on the top layer',
        'placement:UNDERNEATH': 'color tucked underneath',
        'placement:PANELS': 'wide sections',
        'rootBlend:SOLID_TO_ROOT': 'color right to the roots',
        'rootBlend:SHADOW_ROOT': 'softer, darker roots',
        'rootBlend:SEAMLESS_MELT': 'fade with no line',
        'rootBlend:GROWN_OUT': 'grown-out roots',
        'finish:HIGH_SHINE': 'glassy shine',
        'finish:SATIN': 'soft shine',
        'finish:MATTE': 'barely-there shine',
        'dimension:FLAT': 'one even color',
        'dimension:SUBTLE': 'little bit of movement',
        'dimension:MEDIUM': 'mix of light and dark',
        'dimension:HIGH_CONTRAST': 'strong light and dark',
      },

      // What the photograph could NOT settle, in her own understanding check.
      // Part 0 rule 8: the consult says what it could not see rather than
      // filling the gap.
      unsureClauses: {
        'baseLevel': 'The photo doesn’t clearly show how dark the base is.',
        'lightestLevel': 'The photo doesn’t clearly show how light the brightest pieces are.',
        'tone': 'The photo doesn’t clearly show how warm or cool the color is.',
        'technique': 'The photo doesn’t tell us how this result was created.',
        'placement': 'The photo doesn’t clearly show where the color is placed.',
        'rootBlend': 'The photo doesn’t clearly show how the roots blend in.',
        'finish': 'The photo doesn’t clearly show the finish.',
        'dimension': 'The photo doesn’t clearly show the contrast between light and dark.',
      },

      sparkClauses: {
        'the-color': 'like the color',
        'the-cut': 'like the cut',
        'the-layers': 'like the layers',
        'the-movement': 'like the movement',
        'the-length': 'like the length in the picture',
        'the-fullness': 'like the fullness',
        'the-shape': 'like the shape of it',
        'the-whole-thing': 'like the whole thing',
        'not-sure': 'aren’t sure yet what pulled you in',
      },
      lookMatchClauses: {
        'match-selected-parts': 'want those parts as close to the picture as possible, with what you chose to keep preserved',
        'adapt-selected-parts': 'want those parts adapted to you',
        'not-sure': 'want help deciding how closely to match those parts',
      },
      detailClauses: {
        wants: 'are drawn to the {details}',
        avoids: 'want to change the {details}',
        unsure: 'aren’t sure about the {details}',
        conflicting: 'want to clarify what to keep or change about the {details}',
      },
      keepClauses: {
        'my-length': 'want to keep your length',
        'my-color': 'want to keep your color',
        'my-natural-roots': 'want to keep your natural roots',
        'my-natural-texture': 'want to keep your natural texture',
        'my-natural-shape': 'want to keep your natural shape',
      },

      understandingLead: 'You',
      understandingConjunction: 'and',
      understandingClose: 'We’ll help {pro} work out the details.',
      understandingFallback:
        'You’ve shared a picture to explore. We’ll help {pro} work out the details.',
    },
  }
