import { settlePermissionDecision } from '../../src/core/permission-decisions.ts';
import type { SendingPermissionDecision, SettledPermissionDecision } from '../../src/core/permission-decisions.ts';

declare const sending: SendingPermissionDecision;
declare const applied: SettledPermissionDecision;

settlePermissionDecision(sending, 'applied');
settlePermissionDecision(sending, 'uncertain');

// @ts-expect-error Settled decisions cannot be sent through the transition again.
settlePermissionDecision(applied, 'applied');
// @ts-expect-error A sending decision cannot carry a completion timestamp.
const invalidSending: SendingPermissionDecision = { ...sending, updatedAt: 100 };
// @ts-expect-error Settled decisions must include the recorded completion timestamp.
const invalidApplied: SettledPermissionDecision = { ...sending, status: 'applied' };
void invalidSending;
void invalidApplied;
