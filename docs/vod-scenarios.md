# VOD scenarios for milestone two

Status: **approved and implemented; final embedded playback and audio acceptance pending**. Source visual review completed on 17 November 2026. Automated application checks passed; see the [implementation verification record](milestone-2-plan.md#implementation-verification--17-november-2026). Visual source review does not establish final app pause accuracy or absence of audio spoilers.

These are three decision moments from one real TenZ ranked stream, including a linked pair from the same round. The source footage and visible action sequences were inspected through YouTube playback, slow playback, seeking, and frame stepping. The tactical assessments below are AI interpretation, not statements of the player's private intent.

## Source and verification

[WASHED GAMER PLAYS APAC RANKED — TenZ](https://www.youtube.com/watch?v=_yPrykaB2nE), on the verified TenZ channel, duration 4:51:53. YouTube displayed “Streamed live on Aug 15, 2025” in the Australian browser; earlier indexed metadata used August 14. Preserve both values; the reason for the date discrepancy is unverified.

All selected moments show **TenZ playing Clove on Bind**, with his player HUD and minimap. Teammate outlines are ordinary player information. No observer camera changes, spectator enemy x-ray, or omniscient minimap were observed in the selected sequences. The stream facecam remains part of the source. These are ranked examples, not VCT footage.

**Verified:** source identity and watch-page playback, visible pre-decision state, the pro's subsequent action, and the correspondence between the proposed question and that action. Screenshots below record specific observed frames. The full stream was not reviewed.

**Still to verify during implementation:** embedded-player availability, actual stop/resume boundaries on desktop and mobile, and a full normal-speed audio/spoiler pass. An exported auto-generated transcript was checked for contextual speech; it is not a substitute for a complete audio review. The times below are proposed segment boundaries grounded in the inspected source, not a claim that the app already pauses precisely at them.

No video was downloaded or rehosted. Screenshots are review evidence, not proposed production decision-image assets.

| Scenario | Source interval | Decision pause | Reveal end | Teaching focus |
| --- | --- | --- | --- | --- |
| 1. Utility before the next fight | 28:25–28:38 | **28:33** | 28:38 | Utility timing versus immediate weapon readiness |
| 2. Contest the smoke at 35 HP | 31:25–31:37 | **31:29.5** | 31:37 | Taking risk while down a player |
| 3. Reassess after gaining the advantage | 31:43–32:00.5 | **31:53** | 32:00.5 | Adjusting aggression when 3v4 becomes 3v1 |

The equivalent seconds are `(1705, 1713, 1718)`, `(1885, 1889.5, 1897)`, and `(1903, 1913, 1920.5)` for setup start, decision, and reveal end.

## 1. Utility before the next fight

Suggested ID: `bind-clove-utility-window`.

[Watch the setup from 28:25](https://www.youtube.com/watch?v=_yPrykaB2nE&t=1705s). Round 11, attacking, score 7–3. At the proposed pause, the HUD shows 5v5, 100 HP and 50 armour. TenZ is finishing a Vandal reload near A Short/Lamps after firing toward the smoked A site. Nearby teammates and site smokes are visible. Do not present the later kill feed or the later planting banner as knowledge already established at this pause.

**Question:** “You are finishing your reload while your team takes A. What do you do next?”

| Option | Proposed action | Draft analysis |
| --- | --- | --- |
| `use-meddle` | Throw Meddle toward the covered A-site space, then ready the rifle. | Defensible if teammates can cover the brief utility animation and can exploit the timing. The smoke limits certainty about the target position. |
| `cover-contact` | Keep the rifle ready and cover the next contact from this position. | Also defensible when a teammate may need an immediate trade or the utility handoff is unclear. The cost is delaying a useful utility window. |
| `advance-with-team` | Move onto site with a nearby teammate, retaining Meddle for the next contact. | Conditional on a clear route and useful trade spacing. Advancing without accounting for obscured angles can duplicate exposure instead of creating support. |

**Observed pro action:** `use-meddle`. After the reload, TenZ equips the purple Meddle fragment, throws it toward A-site cover, re-equips the Vandal, and fires from the position. The fragment is visibly in hand at 28:34.860 and released at 28:35.415; rifle follow-up is visible by 28:37.5.

**Interpretation:** using a short protected window for utility can prepare the next fight, but its value depends on teammate timing and coverage. Riot describes Meddle as a thrown fragment that temporarily decays targets caught in its effect. The footage does **not** establish that this throw hit an enemy or caused a subsequent kill. Do not award a tactical verdict based on that assumption. [Official Clove ability description](https://playvalorant.com/en-us/agents/clove/)

**Unknowns:** exact enemy positions behind cover/smoke, complete team communications, intended target, whether anyone was affected, and whether a teammate had explicitly taken over the angle. No uniquely preferred option is required for this scenario.

Evidence:

- [Decision frame at 28:32.993](../artifacts/vod-review/scenario-1-decision-28m33s.jpg).
- [Meddle equipped at 28:34.860](../artifacts/vod-review/scenario-1-reveal-28m34s.jpg).
- [Meddle release at 28:35.415](../artifacts/vod-review/scenario-1-throw-28m35s.jpg).

## 2. Contest the smoke at 35 HP

Suggested ID: `bind-clove-smoke-contest`.

[Watch the setup from 31:25](https://www.youtube.com/watch?v=_yPrykaB2nE&t=1885s). Round 13, defending, score 9–3. At the pause, TenZ has 35 HP, a Classic with 11 rounds, and his team is 3v4. He is on A site facing the smoked A Short approach by the teleporter. The lead-in shows his movement from site cover toward that approach. The exact enemy position and the identity of the spike carrier must remain undisclosed before answering.

**Question:** “At 35 HP and down a player, how do you contest this smoked approach?”

| Option | Proposed action | Draft analysis |
| --- | --- | --- |
| `contest-short` | Advance around/through the smoke edge to force a close A Short fight. | The pro's high-risk choice. Close distance can suit the Classic, but limited HP and obscured information make success sensitive to timing and support. |
| `hold-exit` | Hold a tight smoke exit with the pistol ready. | Defensible if the angle gives a favourable first contact and nearby support can trade. It may concede initiative or allow the attackers to wait for better utility. |
| `coordinate-reset` | Reposition toward support and contest together. | Defensible if the movement preserves useful site control. It costs time and can concede space; “fall back” is not automatically the safest option. |

**Observed pro action:** `contest-short`. TenZ advances into the close A Short position, fights with the Classic, kills Fade, and backs toward the site side of the smoke while reloading. The kill feed and “spike carrier killed” banner establish the outcome after the action. These belong only in the reveal.

**Interpretation:** being down a player can justify seeking a favourable isolated fight. This attempt trades information and exposure for a close engagement. The successful kill does not prove the risk was the best choice. Keep the comparison “same/different from TenZ” separate from the assessment of the learner's choice.

**Unknowns:** precise comms, how much enemy positioning was communicated, the reliability of trade support at the chosen instant, and the pro's intended risk calculation. “Conditional aggression” is more supportable than declaring the move universally correct or a proven mistake.

Evidence:

- [Decision state at 31:29.818](../artifacts/vod-review/scenario-2-decision-31m29s.jpg).
- [Kill feed, spike banner and reload at 31:36.068](../artifacts/vod-review/scenario-2-reveal-31m36s.jpg).

## 3. Reassess after gaining the advantage

Suggested ID: `bind-clove-advantage-reset`. Linked follow-up to scenario 2; label that relationship in the UI and still provide a fresh setup.

[Watch the setup from 31:43](https://www.youtube.com/watch?v=_yPrykaB2nE&t=1903s). Same round, defending at 9–3. The team is now 3v1. TenZ remains at 35 HP and has moved through Baths into A Lobby. Around the pause he has his knife out, with the next corner ahead and the remaining Cypher's exact position unconfirmed. The setup must establish the changed numbers and visible teammate positions; do not rely solely on memory of scenario 2.

**Question:** “The round is now 3v1. From this position, how much more space do you take?”

| Option | Proposed action | Draft analysis |
| --- | --- | --- |
| `clear-forward` | Ready the Ghost and clear the next corner deliberately before advancing. | The pro's choice. This limits immediate exposure while retaining pressure, but does not remove the strategic risk of another fight at low HP. |
| `hold-route` | Hold this route and coordinate with the teammates ahead. | Defensible if it preserves useful control and lets the team deny the last player's options. Consider whether the hold actually covers a useful path. |
| `regroup` | Return toward site/support to consolidate the advantage. | Defensible if it preserves spike control and a trade. The return route and lost coverage still matter; retreat is not inherently safer. |

**Observed pro action:** `clear-forward`. TenZ readies the Ghost, checks the corner up the stairs, and continues clearing toward A Short. At 32:00 the pistol remains ready as he looks down the lane. There is no new duel or kill in this selected continuation; do not extend its outcome claim to the eventual round result.

**Interpretation:** the justification for aggression changes when a disadvantage becomes a three-player advantage. The lesson is whether continued pressure remains worthwhile and supported, not the elementary rule “draw your gun before a corner.” This pause evaluates the next action, not the earlier decision to leave site.

The auto-generated transcript around 31:55–31:59 suggests TenZ is considering whether the opponent heard his movement and where that would put them. Treat that as a transcription lead for the audio pass, not confirmed wording or proof of private intention.

**Unknowns:** surviving Cypher's location, complete sound information, team coordination, and which route offers the best support at that instant. An unseen opponent is not evidence that an angle is clear. Multiple answers may be defensible.

Evidence:

- [Decision state at 31:53.521](../artifacts/vod-review/scenario-3-decision-31m53s.jpg).
- [Continued clearing at 32:00.124](../artifacts/vod-review/scenario-3-reveal-32m00s.jpg).

## Publication conditions

1. Approval of this set and the implementation plan has been received.
2. Use the official embedded player with attribution; keep the footage on YouTube.
3. Verify each actual embedded setup/pause/reveal sequence. Move a boundary earlier or reject the segment if action or audio leaks before the question.
4. Keep AI analysis visibly labelled, explain conditions for alternatives, and allow no uniquely preferred option.
5. Do not imply VCT coverage, human coaching review, known enemy information, or confirmed utility impact that this review does not establish.

Only the seven screenshots supporting the selected scenarios are included in the repository. Unused research captures are kept outside version control.
