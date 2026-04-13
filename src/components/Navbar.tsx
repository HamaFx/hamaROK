'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

const links = [
  { href: '/', label: 'Dashboard', icon: '📊' },
  { href: '/upload', label: 'Upload', icon: '📸' },
  { href: '/events', label: 'Events', icon: '📅' },
  { href: '/compare', label: 'Compare', icon: '⚔️' },
  { href: '/insights', label: 'Insights', icon: '📡' },
  { href: '/governors', label: 'Governors', icon: '👥' },
  { href: '/review', label: 'Review', icon: '🧪' },
  { href: '/rankings/review', label: 'Rank Review', icon: '🧩' },
  { href: '/rankings', label: 'Rankings', icon: '🏆' },
  { href: '/calibration', label: 'Calibrate', icon: '🎯' },
  { href: '/settings', label: 'Settings', icon: '⚙️' },
];

export default function Navbar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <Link href="/" className="navbar-brand">
          ⚔️ <span>RoK</span> <span className="gold">Command Center</span>
        </Link>

        <button
          className="navbar-mobile-toggle"
          onClick={() => setOpen(!open)}
          aria-label="Toggle menu"
        >
          {open ? '✕' : '☰'}
        </button>

        <ul className={`navbar-links ${open ? 'open' : ''}`}>
          {links.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className={pathname === link.href ? 'active' : ''}
                onClick={() => setOpen(false)}
              >
                <span>{link.icon}</span>
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
