'use client';

import { MODERATION_ACTION_METADATA } from '@knight/contracts';
import type { ActionPolicy, RATE_LIMITED_MODERATION_ACTIONS } from '@knight/contracts';
import { useState } from 'react';

type RateLimitedAction = (typeof RATE_LIMITED_MODERATION_ACTIONS)[number];
type Unit = 'minute' | 'hour' | 'day';

type EditableWindow = Readonly<{
  max: number | '';
  amount: number | string;
  unit: Unit;
  exact: boolean;
}>;

const UNIT_MS: Readonly<Record<Unit, number>> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
};

function editableWindow(max: number, windowMs: number): EditableWindow {
  for (const unit of ['day', 'hour', 'minute'] as const) {
    if (windowMs % UNIT_MS[unit] === 0) {
      return { max, amount: windowMs / UNIT_MS[unit], unit, exact: true };
    }
  }
  return {
    max,
    amount: (windowMs / UNIT_MS.minute).toString(),
    unit: 'minute',
    exact: false,
  };
}

function blankWindow(): EditableWindow {
  return { max: '', amount: '', unit: 'minute', exact: true };
}

export function RateLimitEditor({
  action,
  enabled: initialEnabled,
  policy,
}: Readonly<{
  action: RateLimitedAction;
  enabled: boolean;
  policy?: ActionPolicy | undefined;
}>) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const initialMode = policy?.enabled && !policy.unlimited ? 'custom' : 'unlimited';
  const [mode, setMode] = useState<'unlimited' | 'custom'>(initialMode);
  const existing = policy?.rateWindows.map((window) =>
    editableWindow(window.max, window.windowMs),
  ) ?? [];
  const [windows, setWindows] = useState<readonly EditableWindow[]>(
    existing.length > 0 ? existing.slice(0, 3) : [blankWindow()],
  );

  const label = MODERATION_ACTION_METADATA[action].label;
  const custom = enabled && mode === 'custom';

  return (
    <fieldset className="capabilityRow">
      <legend>{label}</legend>
      <label className="toggleRow">
        <input
          checked={enabled}
          name={`permission:${action}`}
          onChange={(event) => setEnabled(event.target.checked)}
          type="checkbox"
        />
        <span>Allow through Knight</span>
      </label>

      {enabled ? (
        <div className="rateControls">
          <span className="muted small">Rate limit</span>
          <label>
            <input
              checked={mode === 'unlimited'}
              name={`limitMode:${action}`}
              onChange={() => setMode('unlimited')}
              type="radio"
              value="unlimited"
            />
            Unlimited
          </label>
          <label>
            <input
              checked={mode === 'custom'}
              name={`limitMode:${action}`}
              onChange={() => setMode('custom')}
              type="radio"
              value="custom"
            />
            Custom
          </label>
        </div>
      ) : null}

      {custom ? (
        <div className="windowList">
          {windows.map((window, index) => (
            <div className="windowRow" key={index}>
              <label>
                <span>Maximum</span>
                <input
                  defaultValue={window.max}
                  min="1"
                  name={`limitMax:${action}:${index}`}
                  required
                  type="number"
                />
              </label>
              <label>
                <span>Window</span>
                <input
                  defaultValue={window.amount}
                  min="1"
                  name={`limitAmount:${action}:${index}`}
                  required
                  step="1"
                  type="number"
                />
              </label>
              <label>
                <span>Unit</span>
                <select defaultValue={window.unit} name={`limitUnit:${action}:${index}`} required>
                  <option value="minute">Minutes</option>
                  <option value="hour">Hours</option>
                  <option value="day">Days</option>
                </select>
              </label>
              {!window.exact ? (
                <p className="notice noticeDanger small">
                  This legacy millisecond window is not an exact minute/hour/day value. Choose a new
                  whole-number window before saving.
                </p>
              ) : null}
            </div>
          ))}

          <div className="rateActions">
            <button
              disabled={windows.length >= 3}
              onClick={() => setWindows((current) => [...current, blankWindow()])}
              type="button"
            >
              Add window
            </button>
            <button
              className="secondary"
              disabled={windows.length <= 1}
              onClick={() => setWindows((current) => current.slice(0, -1))}
              type="button"
            >
              Remove window
            </button>
          </div>
        </div>
      ) : null}
    </fieldset>
  );
}
