import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NotFoundState, SessionGate } from '@/components/app/session-gate';

const SessionGateAny = SessionGate as unknown as React.FC<Record<string, unknown>>;

describe('SessionGate', () => {
  it('renders children when ready', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        SessionGateAny,
        { ready: true, loading: false, error: null },
        React.createElement('div', null, 'ready-content')
      )
    );

    expect(html).toContain('ready-content');
    expect(html).not.toContain('Workspace Session');
  });

  it('renders loading state when session is not ready and loading', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        SessionGateAny,
        { ready: false, loading: true, error: null },
        React.createElement('div', null, 'should-not-render')
      )
    );

    expect(html).toContain('Workspace Session');
    expect(html).toContain('Connecting workspace');
    expect(html).not.toContain('should-not-render');
  });

  it('renders provided error and retry label when not ready', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        SessionGateAny,
        {
          ready: false,
          loading: false,
          error: 'No workspace linked',
          retryLabel: 'Reconnect',
        },
        React.createElement('div', null, 'should-not-render')
      )
    );

    expect(html).toContain('No workspace linked');
    expect(html).toContain('Reconnect');
  });

  it('renders not-found empty state helper', () => {
    const html = renderToStaticMarkup(
      React.createElement(NotFoundState, {
        title: 'Missing',
        description: 'Not here',
      })
    );

    expect(html).toContain('Missing');
    expect(html).toContain('Not here');
  });
});
