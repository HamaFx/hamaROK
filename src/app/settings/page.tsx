'use client';

import { useEffect, useState } from 'react';
import { Save, Settings2, Shield, Webhook } from 'lucide-react';
import { FilterBar, KpiCard, PageHero, Panel } from '@/components/ui/primitives';

export default function SettingsPage() {
  const [config, setConfig] = useState({
    t4Weight: 0.5,
    t5Weight: 1.0,
    deadWeight: 5.0,
    kpPerPowerRatio: 0.3,
    deadPerPowerRatio: 0.02,
    discordWebhook: '',
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetch('/api/settings')
      .then((res) => res.json())
      .then((data) => {
        if (!data.error)
          setConfig({
            t4Weight: data.t4Weight ?? 0.5,
            t5Weight: data.t5Weight ?? 1.0,
            deadWeight: data.deadWeight ?? 5.0,
            kpPerPowerRatio: data.kpPerPowerRatio ?? 0.3,
            deadPerPowerRatio: data.deadPerPowerRatio ?? 0.02,
            discordWebhook: data.discordWebhook ?? '',
          });
      });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage('');

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      if (res.ok) setMessage('Settings saved.');
      else setMessage('Failed to save settings.');
    } catch {
      setMessage('Network error.');
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(''), 3000);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setConfig((prev) => ({
      ...prev,
      [name]: name === 'discordWebhook' ? value : Number(value),
    }));
  };

  return (
    <div className="page-container">
      <PageHero
        title="Kingdom Settings"
        subtitle="Configure DKP weighting formulas and outbound integrations for leaderboard publication."
        actions={
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            <Save size={14} /> {saving ? 'Saving...' : 'Save Settings'}
          </button>
        }
      />

      <div className="grid-3 mb-24">
        <KpiCard label="T4 Weight" value={config.t4Weight} hint="Kill score multiplier" tone="info" />
        <KpiCard label="T5 Weight" value={config.t5Weight} hint="Kill score multiplier" tone="warn" />
        <KpiCard label="Dead Weight" value={config.deadWeight} hint="Commitment multiplier" tone="good" />
      </div>

      <div className="grid-2">
        <Panel title="Combat Weighting" subtitle="Core score composition rules">
          <div className="mb-16">
            <label className="form-label">
              <span>T4 Kill Weight</span>
              <span>{config.t4Weight} DKP</span>
            </label>
            <input className="w-full" type="range" name="t4Weight" min="0" max="5" step="0.1" value={config.t4Weight} onChange={handleChange} />
          </div>

          <div className="mb-16">
            <label className="form-label">
              <span>T5 Kill Weight</span>
              <span>{config.t5Weight} DKP</span>
            </label>
            <input className="w-full" type="range" name="t5Weight" min="0" max="10" step="0.5" value={config.t5Weight} onChange={handleChange} />
          </div>

          <div className="mb-16">
            <label className="form-label">
              <span>Dead Troops Weight</span>
              <span>{config.deadWeight} DKP</span>
            </label>
            <input className="w-full" type="range" name="deadWeight" min="0" max="25" step="1" value={config.deadWeight} onChange={handleChange} />
          </div>

          <FilterBar>
            <Settings2 size={14} />
            <span className="text-sm text-muted">These multipliers directly affect warrior score output.</span>
          </FilterBar>
        </Panel>

        <Panel title="Power Expectation Ratios" subtitle="Expected KP/deads per million power">
          <div className="mb-16">
            <label className="form-label">
              <span>Expected KP per 1M power</span>
              <span>{(config.kpPerPowerRatio * 1000).toLocaleString()}k</span>
            </label>
            <input className="w-full" type="range" name="kpPerPowerRatio" min="0" max="2" step="0.05" value={config.kpPerPowerRatio} onChange={handleChange} />
            <div className="text-sm text-muted mt-4">
              Example: 100M power expects {(config.kpPerPowerRatio * 100).toLocaleString()}M KP.
            </div>
          </div>

          <div className="mb-16">
            <label className="form-label">
              <span>Expected Deads per 1M power</span>
              <span>{(config.deadPerPowerRatio * 1000).toLocaleString()}k</span>
            </label>
            <input className="w-full" type="range" name="deadPerPowerRatio" min="0" max="0.5" step="0.01" value={config.deadPerPowerRatio} onChange={handleChange} />
            <div className="text-sm text-muted mt-4">
              Example: 100M power expects {(config.deadPerPowerRatio * 100000).toLocaleString()} deads.
            </div>
          </div>

          <FilterBar>
            <Shield size={14} />
            <span className="text-sm text-muted">Use consistent ratios to reduce ranking volatility across events.</span>
          </FilterBar>
        </Panel>
      </div>

      <Panel title="Discord Integration" subtitle="Leaderboard publication endpoint" className="mt-24">
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Webhook URL</label>
          <input
            type="text"
            className="form-input"
            name="discordWebhook"
            value={config.discordWebhook}
            onChange={handleChange}
            placeholder="https://discord.com/api/webhooks/..."
          />
        </div>
        <FilterBar className="mt-12">
          <Webhook size={14} />
          <span className="text-sm text-muted">Used by Discord publish endpoints and queue retries.</span>
        </FilterBar>
      </Panel>

      {message ? <div className="mt-16 text-sm text-gold">{message}</div> : null}
    </div>
  );
}
