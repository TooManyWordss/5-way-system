export class DiningError extends Error { status: number; constructor(message: string, status?: number); }
export type DiningState = { tables: Record<string, any>; visits: Record<string, any>; counterOrders: Record<string, any> };
export type DiningOperation = { id: string; deviceId: string; at: string; type: string; targetId: string; expectedVersion: number; payload: any; dependsOn?: string };
export function emptyDining(): DiningState;
export function clone<T>(value: T): T;
export function text(value: unknown, label: string, max?: number, optional?: boolean): string;
export function integer(value: unknown, label: string, min?: number, max?: number): number;
export function timestamp(value: unknown): string;
export function totals(visit: any, taxRate?: number): { subtotal_cents: number; discount_cents: number; tax_cents: number; total_cents: number };
export function ticketState(submission: any): string;
export function linesOf(visit: any): any[];
export function applyDining(state: DiningState, operation: DiningOperation, context: { role: string; menu: any[]; taxRate: number }): DiningState;
export function diningMetrics(state: DiningState, from: string, to: string): any;
