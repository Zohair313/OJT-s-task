import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

interface ThemeToggleProps {
  className?: string;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({ className = '' }) => {
  const { isDark, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      type="button"
      title={`Switch to ${isDark ? 'Light' : 'Dark'} Theme`}
      className={`relative inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-all duration-200 select-none shadow-xs cursor-pointer ${
        isDark
          ? 'bg-slate-900 border-slate-700 text-amber-300 hover:bg-slate-800 hover:border-slate-600'
          : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300'
      } ${className}`}
    >
      <div className="flex items-center gap-1.5">
        {isDark ? (
          <>
            <Moon className="w-3.5 h-3.5 text-indigo-400 animate-in spin-in-180 duration-200" />
            <span className="text-[11px] font-medium text-slate-200">Dark</span>
          </>
        ) : (
          <>
            <Sun className="w-3.5 h-3.5 text-amber-500 animate-in spin-in-180 duration-200" />
            <span className="text-[11px] font-medium text-slate-700">Light</span>
          </>
        )}
      </div>
      <span className="sr-only">Toggle Theme</span>
    </button>
  );
};
