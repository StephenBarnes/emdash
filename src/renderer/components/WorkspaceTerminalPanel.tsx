import React from 'react';
import { TerminalPane } from './TerminalPane';
import { Bot, Terminal } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';

interface Workspace {
  id: string;
  name: string;
  branch: string;
  path: string;
  status: 'active' | 'idle' | 'running';
}

interface Props {
  workspace: Workspace | null;
  className?: string;
}

const WorkspaceTerminalPanelComponent: React.FC<Props> = ({ workspace, className }) => {
  const { effectiveTheme } = useTheme();

  if (!workspace) {
    return (
      <div
        className={`flex h-full flex-col items-center justify-center bg-gray-50 dark:bg-gray-900 ${className}`}
      >
        <Bot className="mb-2 h-8 w-8 text-gray-400" />
        <h3 className="mb-1 text-sm text-gray-600 dark:text-gray-400">No Workspace Selected</h3>
        <p className="text-center text-xs text-gray-500 dark:text-gray-500">
          Select a workspace to view its terminal
        </p>
      </div>
    );
  }

  return (
    <div className={`flex h-full flex-col bg-white dark:bg-gray-800 ${className}`}>
      <div className="flex items-center border-b border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900">
        <div className="flex min-w-0 items-center space-x-2">
          <h3
            className="max-w-[220px] truncate text-sm font-medium text-gray-900 dark:text-gray-100"
            title={workspace.name}
          >
            Terminal
          </h3>
        </div>
      </div>

      {(() => {
        let isCharm = false;
        try {
          const p =
            localStorage.getItem(`provider:last:${workspace.id}`) ||
            localStorage.getItem(`provider:locked:${workspace.id}`) ||
            localStorage.getItem(`workspaceProvider:${workspace.id}`);
          isCharm = p === 'charm';
        } catch {}
        return (
          <div
            className={`bw-terminal flex-1 overflow-hidden ${effectiveTheme === 'dark' ? 'bg-gray-800' : 'bg-white'}`}
          >
            <TerminalPane
              id={`workspace-${workspace.id}`}
              cwd={workspace.path}
              variant={effectiveTheme === 'dark' ? 'dark' : 'light'}
              keepAlive
              themeOverride={
                effectiveTheme === 'dark'
                  ? {
                      background: '#1f2937',
                      foreground: '#ffffff',
                      cursor: '#ffffff',
                      selectionBackground: '#ffffff33',
                      // Keep ANSI backgrounds matching the dark theme background
                      black: '#1f2937',
                      red: '#ffffff',
                      green: '#ffffff',
                      yellow: '#ffffff',
                      blue: '#ffffff',
                      magenta: '#ffffff',
                      cyan: '#ffffff',
                      white: '#ffffff',
                      brightBlack: '#ffffff',
                      brightRed: '#ffffff',
                      brightGreen: '#ffffff',
                      brightYellow: '#ffffff',
                      brightBlue: '#ffffff',
                      brightMagenta: '#ffffff',
                      brightCyan: '#ffffff',
                      brightWhite: '#ffffff',
                    }
                  : {
                      background: '#ffffff',
                      foreground: '#000000',
                      cursor: '#000000',
                      selectionBackground: '#00000033',
                      // Keep ANSI backgrounds white; force all other colors to black
                      black: '#ffffff',
                      red: '#000000',
                      green: '#000000',
                      yellow: '#000000',
                      blue: '#000000',
                      magenta: '#000000',
                      cyan: '#000000',
                      white: '#000000',
                      brightBlack: '#000000',
                      brightRed: '#000000',
                      brightGreen: '#000000',
                      brightYellow: '#000000',
                      brightBlue: '#000000',
                      brightMagenta: '#000000',
                      brightCyan: '#000000',
                      brightWhite: '#000000',
                    }
              }
              className="h-full w-full"
            />
          </div>
        );
      })()}
    </div>
  );
};
export const WorkspaceTerminalPanel = React.memo(WorkspaceTerminalPanelComponent);

export default WorkspaceTerminalPanel;
