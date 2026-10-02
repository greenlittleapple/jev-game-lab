import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validatePlan} from './plan-schema.mjs';

const schema = {type: 'object', required: ['name', 'steps', 'risk'], properties: {
 name: {type: 'string', maxLength: 5}, risk: {type: 'string', enum: ['low', 'high']}, ok: {type: 'boolean'}, share: {type: 'number', minimum: 0, maximum: 1},
 steps: {type: 'array', maxItems: 2, items: {type: 'object', required: ['id', 'round'], properties: {id: {type: 'string', pattern: '^s\\d$'}, round: {type: 'integer', minimum: 1, maximum: 100}}}},
 extra: {type: 'object', additionalProperties: true, properties: {}},
}};

test('a valid value has no errors', () => {
 assert.deepEqual(validatePlan({name: 'a', risk: 'low', ok: true, share: 0.5, steps: [{id: 's1', round: 3}], extra: {anything: 1}}, schema), []);
});

test('errors name the path, as the STS2 validator did, plus the new range and length keywords', () => {
 assert.deepEqual(validatePlan({name: 'toolong', risk: 'mid', ok: 'yes', share: 2, steps: [{id: 'x', round: 0}, {id: 's2', round: 1.5}, {id: 's3', round: 5}], bogus: 1}, schema), [
  'plan.name is longer than 5 characters', 'plan.risk must be one of low, high', 'plan.ok must be a boolean', 'plan.share must be at most 1',
  'plan.steps allows at most 2 entries', 'plan.steps[0].id must match ^s\\d$', 'plan.steps[0].round must be at least 1', 'plan.steps[1].round must be an integer',
  'plan.bogus is not allowed']);
 assert.deepEqual(validatePlan({steps: 'none'}, schema), ['plan.name is required', 'plan.risk is required', 'plan.steps must be an array']);
 assert.deepEqual(validatePlan([], schema), ['plan must be an object']);
 assert.deepEqual(validatePlan({name: 'a', risk: 'low', steps: [], share: Number.NaN}, schema), ['plan.share must be a number']);
});
