import "server-only";
import type {
  AIAnalysis,
  Assessment,
  ChallengeDetail,
  ChallengeSource,
  ObservedAction,
  YouTubeSegment,
} from "@/contracts/challenge";

export type AuthoredChallenge = Omit<
  ChallengeDetail,
  "options" | "source" | "setup" | "decision"
> & {
  question: string;
  source: ChallengeSource;
  knownFacts: string[];
  unknowns: string[];
  setup: YouTubeSegment;
  decision: { kind: "paused-video"; atSeconds: number; alt: string };
  options: {
    id: string;
    label: string;
    assessment: Assessment;
    explanation: string;
    acceptableWhen: string[];
    risks: string[];
  }[];
  observedAction: ObservedAction;
  analysis: AIAnalysis;
  takeaway: string;
  reveal: YouTubeSegment;
  outcomeText: string;
  review: {
    reviewedBy: "assistant";
    reviewedAt: string;
    visual: "verified";
    audio: "pending" | "verified";
    embed: "pending" | "verified";
    evidence: string[];
    notes: string[];
  };
};

const VIDEO_ID = "_yPrykaB2nE";
const SOURCE: Omit<ChallengeSource, "round" | "score" | "side"> = {
  kind: "youtube",
  videoId: VIDEO_ID,
  url: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
  title: "WASHED GAMER PLAYS APAC RANKED",
  uploader: "TenZ",
  player: "TenZ",
  matchType: "ranked",
  map: "Bind",
  agent: "Clove",
  publishedDate: "2025-08-15",
  dateNote:
    "YouTube displayed August 15, 2025; earlier indexed metadata used August 14. The reason for this date discrepancy is unverified.",
};

const AI_NOTICE =
  "AI-authored interpretation based on the available POV. The observed action is separate from decision quality; private intent and complete team communications are unknown.";

const REVIEW_NOTES = [
  "Player POV and visible action sequence inspected through source playback and frame stepping; no observer-only enemy information was observed in the selected interval.",
  "Normal-speed audio/spoiler review and embedded pause/resume checks remain separate acceptance gates.",
];

export const CHALLENGES: readonly AuthoredChallenge[] = [
  {
    id: "bind-clove-utility-window",
    title: "Utility before the next fight",
    topic: "Utility timing",
    order: 1,
    mediaStatus: "ready",
    contentVersion: "vod-1",
    question:
      "You are finishing your reload while your team takes A. What do you do next?",
    context:
      "Bind, attacking at 7–3. You are Clove near A Short/Lamps with a Vandal reload in progress. Your teammates are taking A while smokes obscure parts of the site. Decide what to do as the reload completes.",
    source: { ...SOURCE, round: 11, score: "7–3", side: "attack" },
    knownFacts: [
      "At the pause, both teams still have five players alive.",
      "You have 100 HP and 50 armour; your Vandal reload is in progress.",
      "Nearby teammates and A-site smokes are visible from your POV.",
    ],
    unknowns: [
      "Exact enemy positions behind the smoke and cover.",
      "Whether a teammate has explicitly taken over your angle.",
      "Complete team communications and the intended utility target.",
    ],
    setup: {
      kind: "youtube",
      videoId: VIDEO_ID,
      startSeconds: 1705,
      endSeconds: 1713,
      alt: "TenZ's Clove POV approaching the smoked A site on Bind and beginning a Vandal reload.",
      caption: "TenZ · Clove · Bind · Round 11 · Attacking",
    },
    decision: {
      kind: "paused-video",
      atSeconds: 1713,
      alt: "Paused before the next action: a reload is finishing near A Short/Lamps while teammates take the site.",
    },
    options: [
      {
        id: "use-meddle",
        label: "Throw Meddle toward site cover, then ready the rifle",
        assessment: "reasonable",
        explanation:
          "A short protected utility window can prepare the next fight while your teammates gain space. Its value depends on their ability to cover the animation and act on the timing; the smoke prevents certainty about the target.",
        acceptableWhen: [
          "A teammate can cover the immediate contact while your weapon is unavailable.",
          "The team is close enough to exploit the utility timing.",
        ],
        risks: [
          "An immediate fight may arrive during the equip and throw animation.",
          "Hidden enemy positions can make the throw ineffective.",
        ],
      },
      {
        id: "cover-contact",
        label: "Keep the rifle ready and cover the next contact",
        assessment: "reasonable",
        explanation:
          "Keeping your rifle ready preserves an immediate trade if a teammate meets resistance. That can be preferable when responsibility for the angle is unclear, although it delays the utility window.",
        acceptableWhen: [
          "A teammate may need an immediate trade from your current angle.",
          "No one has clearly taken over your weapon coverage.",
        ],
        risks: [
          "Waiting can miss the opportunity to combine utility with the site's entry timing.",
          "Your angle may duplicate a teammate's coverage instead of adding support.",
        ],
      },
      {
        id: "advance-with-team",
        label: "Advance with a teammate and retain Meddle",
        assessment: "reasonable",
        explanation:
          "Moving closer can improve access to the next trade while retaining utility for new information. It is conditional on the route being clear and the movement creating useful spacing rather than another exposed player.",
        acceptableWhen: [
          "The path is clear enough to move with your weapon ready.",
          "The new position gives you a timely trade without abandoning necessary coverage.",
        ],
        risks: [
          "Smokes and cover can conceal angles along the route.",
          "Advancing without coordination can duplicate exposure and lose the original angle.",
        ],
      },
    ],
    observedAction: {
      optionId: "use-meddle",
      description:
        "TenZ finishes the reload, equips Meddle, throws it toward A-site cover, then re-equips the Vandal and fires from the position.",
    },
    analysis: {
      author: "ai",
      notice: AI_NOTICE,
      rationale:
        "This choice uses a brief moment near cover to prepare the next engagement. The relevant tradeoff is utility timing versus immediate weapon coverage. The POV supports what was thrown, but does not establish a uniquely best choice without the team's coverage and timing commitments.",
      limitations: [
        "The selected footage does not establish that Meddle affected an enemy or caused a kill.",
        "Complete communications and the player's intended target are unknown.",
        "Several options can be defensible under different coverage assumptions.",
      ],
    },
    takeaway:
      "Choose a utility window around who can cover the next contact and who can exploit the timing.",
    reveal: {
      kind: "youtube",
      videoId: VIDEO_ID,
      startSeconds: 1713,
      endSeconds: 1718,
      alt: "TenZ completes the reload, throws Clove's Meddle toward A-site cover, and returns to the rifle.",
      caption: "Observed continuation · utility, then rifle",
    },
    outcomeText:
      "Meddle is visibly equipped and released, followed by rifle fire. This sequence does not confirm an enemy hit or establish that the utility caused a later kill.",
    review: {
      reviewedBy: "assistant",
      reviewedAt: "2026-11-17",
      visual: "verified",
      audio: "pending",
      embed: "pending",
      evidence: [
        "artifacts/vod-review/scenario-1-decision-28m33s.jpg",
        "artifacts/vod-review/scenario-1-reveal-28m34s.jpg",
        "artifacts/vod-review/scenario-1-throw-28m35s.jpg",
      ],
      notes: [...REVIEW_NOTES],
    },
  },
  {
    id: "bind-clove-smoke-contest",
    title: "Contest the smoke at 35 HP",
    topic: "Risk while disadvantaged",
    order: 2,
    mediaStatus: "ready",
    contentVersion: "vod-1",
    question:
      "At 35 HP and down a player, how do you contest this smoked approach?",
    context:
      "Bind, defending at 9–3. You are on A site facing the smoked A Short approach by the teleporter. Your team is down a player, and you have a Classic and little health. Choose how to contest the space.",
    source: { ...SOURCE, round: 13, score: "9–3", side: "defense" },
    knownFacts: [
      "At the pause, your team has three players alive against four opponents.",
      "You have 35 HP and a Classic with 11 rounds loaded.",
      "A smoke obscures the A Short approach near the teleporter.",
    ],
    unknowns: [
      "The exact enemy position beyond the smoke.",
      "How reliably nearby teammates can trade this immediate fight.",
      "Complete communications and any positioning information shared earlier.",
    ],
    setup: {
      kind: "youtube",
      videoId: VIDEO_ID,
      startSeconds: 1885,
      endSeconds: 1889.5,
      alt: "TenZ's low-health Clove approaches the smoked A Short entrance on Bind with a Classic.",
      caption: "TenZ · Clove · Bind · Round 13 · Defending",
    },
    decision: {
      kind: "paused-video",
      atSeconds: 1889.5,
      alt: "Paused with 35 HP and a Classic before contesting the smoke at A Short.",
    },
    options: [
      {
        id: "contest-short",
        label: "Advance at the smoke edge for a close A Short fight",
        assessment: "risky",
        explanation:
          "A close engagement can suit the Classic and create a chance to recover the player disadvantage. With 35 HP and obscured information, however, this is conditional aggression: a poor timing or an untradeable exposure can quickly worsen the round.",
        acceptableWhen: [
          "Information or a timing cue gives a credible chance of isolating a close fight.",
          "A teammate can support the contact or benefit immediately from the space gained.",
        ],
        risks: [
          "Low HP leaves little margin for an unfavourable first contact.",
          "The smoke can hide another angle or opponent who can trade you.",
        ],
      },
      {
        id: "hold-exit",
        label: "Hold a tight smoke exit with the pistol ready",
        assessment: "reasonable",
        explanation:
          "Holding can make the next contact more controlled while retaining a ready pistol. It is defensible if the exit gives a useful first-shot opportunity and support can trade, but the attackers may wait or use utility instead of walking into it.",
        acceptableWhen: [
          "The held exit limits the angles you must face.",
          "Nearby support makes the contact useful even if you fall.",
        ],
        risks: [
          "The attackers can wait for better utility or shift the fight elsewhere.",
          "A predictable close hold can be cleared before you get a favourable shot.",
        ],
      },
      {
        id: "coordinate-reset",
        label: "Reposition toward support and contest together",
        assessment: "reasonable",
        explanation:
          "Repositioning can turn the next fight into a coordinated contact instead of an isolated low-health duel. The value depends on which space remains controlled and whether the move preserves useful access to the site.",
        acceptableWhen: [
          "The transition preserves an angle or route the team needs.",
          "The team can coordinate its next contact before conceding too much space.",
        ],
        risks: [
          "Moving costs time and can concede the initiative.",
          "Retreating into the same vulnerable position as a teammate may not improve the trade.",
        ],
      },
    ],
    observedAction: {
      optionId: "contest-short",
      description:
        "TenZ advances into the close A Short position, fights with the Classic, kills Fade, and backs toward the site side of the smoke while reloading.",
    },
    analysis: {
      author: "ai",
      notice: AI_NOTICE,
      rationale:
        "Being down a player can justify taking a calculated risk to recover space or isolate a fight. The close Classic engagement succeeds here, but its outcome does not prove the decision was best. With only the visible information, the exposure remains high-risk and the hold or coordinated reset can also be defensible.",
      limitations: [
        "The pro's full information and intended risk calculation are unknown.",
        "The reliability of immediate trade support is not fully established.",
        "A successful kill does not turn this into a universally correct decision.",
      ],
    },
    takeaway:
      "Judge the information, isolation and support behind an aggressive timing—not just whether the duel was won.",
    reveal: {
      kind: "youtube",
      videoId: VIDEO_ID,
      startSeconds: 1889.5,
      endSeconds: 1897,
      alt: "TenZ contests A Short, kills Fade with the Classic, and reloads while moving back behind the smoke.",
      caption: "Observed continuation · close fight and reset",
    },
    outcomeText:
      "TenZ kills Fade; the kill feed and spike-carrier banner establish that the defeated player carried the spike. He then moves back and reloads. That result was not available when you chose.",
    review: {
      reviewedBy: "assistant",
      reviewedAt: "2026-11-17",
      visual: "verified",
      audio: "pending",
      embed: "pending",
      evidence: [
        "artifacts/vod-review/scenario-2-decision-31m29s.jpg",
        "artifacts/vod-review/scenario-2-reveal-31m36s.jpg",
      ],
      notes: [...REVIEW_NOTES],
    },
  },
  {
    id: "bind-clove-advantage-reset",
    title: "Reassess after gaining the advantage",
    topic: "Adjusting aggression",
    order: 3,
    mediaStatus: "ready",
    contentVersion: "vod-1",
    linkedScenarioId: "bind-clove-smoke-contest",
    question:
      "The round is now 3v1. From this position, how much more space do you take?",
    context:
      "A linked follow-up from the same Bind round. The numbers have changed: at the pause your team is 3v1. You are still at 35 HP and have moved through Baths into A Lobby. Reassess the next action from this position.",
    source: { ...SOURCE, round: 13, score: "9–3", side: "defense" },
    knownFacts: [
      "At the pause, your team is 3v1 and you remain at 35 HP.",
      "You are in A Lobby with the next corner ahead and your knife out.",
      "The remaining opponent is Cypher; teammate positions are visible in the POV.",
    ],
    unknowns: [
      "The surviving Cypher's exact location and what they heard.",
      "Complete sound information and team coordination.",
      "Which route best preserves useful control and a timely trade.",
    ],
    setup: {
      kind: "youtube",
      videoId: VIDEO_ID,
      startSeconds: 1903,
      endSeconds: 1913,
      alt: "TenZ moves through Baths into A Lobby as his team's player advantage grows in the same Bind round.",
      caption: "Linked follow-up · same round, changed numbers",
    },
    decision: {
      kind: "paused-video",
      atSeconds: 1913,
      alt: "Paused in A Lobby with 35 HP and a 3v1 advantage before taking more space.",
    },
    options: [
      {
        id: "clear-forward",
        label: "Ready the Ghost and clear the next corner deliberately",
        assessment: "reasonable",
        explanation:
          "Deliberate clearing limits the immediate exposure while retaining pressure. It can be useful when the space constrains the last opponent, but a careful weapon-ready peek still carries the strategic risk of another fight at low HP.",
        acceptableWhen: [
          "The next piece of space has a concrete value for the team's control.",
          "You can limit exposed angles and retain useful teammate support.",
        ],
        risks: [
          "A new isolated duel can give the remaining opponent a route back into the round.",
          "An unseen opponent is not evidence that the next angle is clear.",
        ],
      },
      {
        id: "hold-route",
        label: "Hold this route and coordinate with teammates ahead",
        assessment: "reasonable",
        explanation:
          "Holding can preserve control while the team denies the remaining opponent's options. The key is whether this route matters and the positions support one another, not simply refusing to move because you are ahead.",
        acceptableWhen: [
          "Your hold denies a useful path the last opponent may need.",
          "Teammates can coordinate coverage rather than offer separate fights.",
        ],
        risks: [
          "Holding an irrelevant route can leave the decisive area unsupported.",
          "Disconnected positions can still be defeated one at a time.",
        ],
      },
      {
        id: "regroup",
        label: "Return toward site support to consolidate the advantage",
        assessment: "reasonable",
        explanation:
          "Regrouping can strengthen a trade and preserve control of the objective. It is defensible when the return route is safe enough and the move does not abandon the very path that is keeping the opponent constrained.",
        acceptableWhen: [
          "Returning preserves objective control and creates a better trade.",
          "The route back is understood and the coverage you leave is accounted for.",
        ],
        risks: [
          "The transition can expose you to a new angle.",
          "Leaving useful route control may create an opening for the last opponent.",
        ],
      },
    ],
    observedAction: {
      optionId: "clear-forward",
      description:
        "TenZ readies the Ghost, checks the corner up the stairs, and continues clearing toward A Short with the pistol ready.",
    },
    analysis: {
      author: "ai",
      notice: AI_NOTICE,
      rationale:
        "The justification for taking risk has changed since the 3v4 smoke contest. Continuing to clear may preserve useful pressure, while holding or regrouping may better consolidate support. Evaluate the value of the next space and the cost of another low-health duel. This pause does not establish whether the earlier decision to leave site was best.",
      limitations: [
        "The last opponent's position and complete sound information remain unknown.",
        "The clip shows continued clearing, not a new duel or the eventual round result.",
        "No uniquely preferred option is established by the visible information.",
      ],
    },
    takeaway:
      "Reassess the purpose of aggression when the numbers change; careful mechanics do not remove the cost of an unnecessary duel.",
    reveal: {
      kind: "youtube",
      videoId: VIDEO_ID,
      startSeconds: 1913,
      endSeconds: 1920.5,
      alt: "TenZ draws the Ghost and carefully clears the route toward A Short without a new fight in this continuation.",
      caption: "Observed continuation · deliberate clearing",
    },
    outcomeText:
      "TenZ advances with the Ghost ready and continues checking the lane. There is no new duel or kill in this selected continuation; it does not show the eventual round outcome.",
    review: {
      reviewedBy: "assistant",
      reviewedAt: "2026-11-17",
      visual: "verified",
      audio: "pending",
      embed: "pending",
      evidence: [
        "artifacts/vod-review/scenario-3-decision-31m53s.jpg",
        "artifacts/vod-review/scenario-3-reveal-32m00s.jpg",
      ],
      notes: [
        ...REVIEW_NOTES,
        "Auto-generated speech transcription is a review lead, not confirmed wording or proof of private intention.",
      ],
    },
  },
];
