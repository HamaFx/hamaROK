'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import { OCR_TEMPLATES } from '@/lib/ocr/templates';

type Region = { x: number; y: number; width: number; height: number };

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

export default function CalibrationPage() {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageSize, setImageSize] = useState({ width: 1600, height: 900 });
  const [templateId, setTemplateId] = useState(OCR_TEMPLATES[0].id);
  const [xOffset, setXOffset] = useState(0);
  const [yOffset, setYOffset] = useState(0);
  const [xScale, setXScale] = useState(1);
  const [yScale, setYScale] = useState(1);

  const template = useMemo(
    () => OCR_TEMPLATES.find((item) => item.id === templateId) || OCR_TEMPLATES[0],
    [templateId]
  );

  const calibratedRegions = useMemo(() => {
    const out: Record<string, Region> = {};
    for (const [key, region] of Object.entries(template.regions)) {
      const width = clamp(region.width * xScale, 0.01, 1);
      const height = clamp(region.height * yScale, 0.01, 1);
      const x = clamp(region.x + xOffset, 0, 1 - width);
      const y = clamp(region.y + yOffset, 0, 1 - height);
      out[key] = { x, y, width, height };
    }
    return out;
  }, [template.regions, xOffset, yOffset, xScale, yScale]);

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>🎯 OCR Template Calibration</h1>
        <p>Calibrate region overlays by template/profile and export tuned coordinates for OCR.</p>
      </div>

      <div className="card card-no-hover mb-24">
        <div className="grid-2">
          <div className="form-group">
            <label className="form-label">Template Profile</label>
            <select
              className="form-select"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
            >
              {OCR_TEMPLATES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label} ({item.id})
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Screenshot</label>
            <input
              className="form-input"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const next = URL.createObjectURL(file);
                const probe = new window.Image();
                probe.onload = () => {
                  setImageSize({
                    width: probe.naturalWidth || 1600,
                    height: probe.naturalHeight || 900,
                  });
                };
                probe.src = next;
                if (imageUrl) URL.revokeObjectURL(imageUrl);
                setImageUrl(next);
              }}
            />
          </div>
        </div>

        <div className="grid-2">
          <div className="form-group">
            <label className="form-label">X Offset ({xOffset.toFixed(3)})</label>
            <input
              type="range"
              min={-0.1}
              max={0.1}
              step={0.001}
              value={xOffset}
              onChange={(e) => setXOffset(Number(e.target.value))}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Y Offset ({yOffset.toFixed(3)})</label>
            <input
              type="range"
              min={-0.1}
              max={0.1}
              step={0.001}
              value={yOffset}
              onChange={(e) => setYOffset(Number(e.target.value))}
            />
          </div>
          <div className="form-group">
            <label className="form-label">X Scale ({xScale.toFixed(2)})</label>
            <input
              type="range"
              min={0.8}
              max={1.2}
              step={0.01}
              value={xScale}
              onChange={(e) => setXScale(Number(e.target.value))}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Y Scale ({yScale.toFixed(2)})</label>
            <input
              type="range"
              min={0.8}
              max={1.2}
              step={0.01}
              value={yScale}
              onChange={(e) => setYScale(Number(e.target.value))}
            />
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card card-no-hover">
          <h3 className="mb-16">Overlay Preview</h3>
          {imageUrl ? (
            <div style={{ position: 'relative', width: '100%', overflow: 'hidden', borderRadius: 12 }}>
              <Image
                src={imageUrl}
                alt="Calibration"
                width={imageSize.width}
                height={imageSize.height}
                style={{ width: '100%', height: 'auto', display: 'block' }}
                unoptimized
              />
              {Object.entries(calibratedRegions).map(([key, region]) => (
                <div
                  key={key}
                  title={key}
                  style={{
                    position: 'absolute',
                    left: `${region.x * 100}%`,
                    top: `${region.y * 100}%`,
                    width: `${region.width * 100}%`,
                    height: `${region.height * 100}%`,
                    border: '2px solid rgba(245,158,11,0.9)',
                    background: 'rgba(245,158,11,0.08)',
                    color: '#f59e0b',
                    fontSize: 11,
                    padding: 2,
                    pointerEvents: 'none',
                  }}
                >
                  {key}
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state" style={{ padding: 24 }}>
              <div className="empty-icon">📷</div>
              <h3>Upload a screenshot</h3>
              <p>Field overlays will appear here for calibration.</p>
            </div>
          )}
        </div>

        <div className="card card-no-hover">
          <h3 className="mb-16">Calibrated JSON</h3>
          <pre
            style={{
              background: 'var(--color-bg-tertiary)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 12,
              padding: 16,
              overflowX: 'auto',
              maxHeight: 520,
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
{JSON.stringify(
  {
    templateId,
    calibration: {
      xOffset,
      yOffset,
      xScale,
      yScale,
    },
    regions: calibratedRegions,
  },
  null,
  2
)}
          </pre>
        </div>
      </div>
    </div>
  );
}
