// Zero-leak mode (--zero-leak; btd6-jev-v6, btd6-playbook-v5 and btd6-claude-v1): the policy and the speed
// controller treat the match as if it had one life, whatever its real lives. With one life the floor rules run their
// CHIMPS branches (the early one-life margin, early_short, threat_short's binding, lead_capacity saving, the one-life
// tower cap and its bindings, moab_short's binding, the DDT lead and saving) and every lives margin (estimate.mjs
// margin, moab.mjs moabCheck) is the one-life margin. The aim is a Hard Standard game with no lives lost.
//
// The seam is a state view: the game adapter's policy hooks and graded speed's margins read zeroLeakView(state),
// which is the state with lives set to ZERO_LEAK_LIVES. The rest reads the real state: the run log, the match
// tracker (leaks, leak pressure, lives lost), the strategist's triggers and brief, and the `lives` Jev's question
// shows (its estimates and verdicts use the view).
export const ZERO_LEAK_LIVES = 1;
export const ZERO_LEAK_POLICIES = ['btd6-jev-v6', 'btd6-playbook-v5', 'btd6-claude-v1'];
export const zeroLeakFor = policy => ZERO_LEAK_POLICIES.includes(policy);

// The state the policy sees: lives set to one in a match; anything else unchanged.
export const zeroLeakView = state => state?.in_game ? {...state, lives: ZERO_LEAK_LIVES} : state;

// The game adapter's hooks that decide from the state (core/hierarchical.mjs): they get the view.
const POLICY_HOOKS = ['rules', 'constrain', 'group', 'plan', 'tieBreak'];

// A game adapter (game.mjs) whose policy hooks read zeroLeakView. The question is built from the view and then
// shows the real lives. Triggers, the strategist brief and the request stamp keep the real state.
export function zeroLeakGame(game) {
 const out = {...game};
 for (const hook of POLICY_HOOKS) if (game[hook]) out[hook] = (state, ...rest) => game[hook](zeroLeakView(state), ...rest);
 if (game.question) out.question = (state, ...rest) => realLives(game.question(zeroLeakView(state), ...rest), state);
 if (game.majorityWait?.eligible) out.majorityWait = {...game.majorityWait, eligible: (state, ...rest) => game.majorityWait.eligible(zeroLeakView(state), ...rest)};
 return out;
}

// A question payload with the real lives in its match facts.
function realLives(payload, state) {
 const match = payload?.state?.match;
 if (!match || !('lives' in match) || !state?.in_game) return payload;
 return {...payload, state: {...payload.state, match: {...match, lives: state.lives}}};
}
