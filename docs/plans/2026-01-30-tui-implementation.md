# TUI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a terminal UI for browsing the Delica parts database with diagram images.

**Architecture:** Ink (React) TUI in a separate `tui/` Node package. Reads from the existing SQLite database at `data/delica.db`. Uses Kitty protocol for inline images in Ghostty.

**Tech Stack:** Node.js, TypeScript, Ink, better-sqlite3, terminal-image

---

## Task 1: Project Setup

**Files:**
- Create: `tui/package.json`
- Create: `tui/tsconfig.json`
- Create: `tui/src/index.tsx`

**Step 1: Create package.json**

```json
{
  "name": "@delica/tui",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "tsx src/index.tsx",
    "build": "tsc",
    "dev": "tsx watch src/index.tsx"
  },
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "ink": "^5.0.1",
    "ink-text-input": "^6.0.0",
    "react": "^18.3.1",
    "terminal-image": "^3.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/react": "^18.3.3",
    "tsx": "^4.19.0",
    "typescript": "^5.5.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

**Step 3: Create minimal entry point**

```tsx
// tui/src/index.tsx
import React from 'react';
import { render, Text } from 'ink';

function App() {
  return <Text>Delica Parts TUI</Text>;
}

render(<App />);
```

**Step 4: Install dependencies**

Run: `cd tui && npm install`

**Step 5: Verify it runs**

Run: `cd tui && npm start`
Expected: "Delica Parts TUI" prints to terminal

**Step 6: Commit**

```bash
git add tui/
git commit -m "feat(tui): initialize Node/Ink project structure"
```

---

## Task 2: Database Layer

**Files:**
- Create: `tui/src/db.ts`
- Create: `tui/src/types.ts`

**Step 1: Create types**

```typescript
// tui/src/types.ts
export interface Group {
  id: string;
  name: string;
}

export interface Subgroup {
  id: string;
  name: string;
  group_id: string;
}

export interface Diagram {
  id: string;
  group_id: string;
  subgroup_id: string | null;
  name: string;
  image_url: string | null;
  image_path: string | null;
  source_url: string;
}

export interface Part {
  id: number;
  detail_page_id: string | null;
  part_number: string;
  pnc: string | null;
  description: string | null;
  ref_number: string | null;
  quantity: number | null;
  spec: string | null;
  notes: string | null;
  color: string | null;
  model_date_range: string | null;
  price_usd: number | null;
  diagram_id: string;
  group_id: string;
  subgroup_id: string | null;
  replacement_part_number: string | null;
}

export interface PartWithDiagram extends Part {
  image_path: string | null;
}

export interface SearchResult extends PartWithDiagram {
  group_name: string;
  subgroup_name: string | null;
}
```

**Step 2: Create database module**

```typescript
// tui/src/db.ts
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Group, Subgroup, Diagram, PartWithDiagram, SearchResult } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, '../../data/delica.db');

const db = new Database(dbPath, { readonly: true });

export const queries = {
  getGroups(): Group[] {
    return db.prepare('SELECT * FROM groups ORDER BY name').all() as Group[];
  },

  getSubgroups(groupId: string): Subgroup[] {
    return db.prepare('SELECT * FROM subgroups WHERE group_id = ? ORDER BY name')
      .all(groupId) as Subgroup[];
  },

  getGroup(groupId: string): Group | undefined {
    return db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId) as Group | undefined;
  },

  getSubgroup(subgroupId: string): Subgroup | undefined {
    return db.prepare('SELECT * FROM subgroups WHERE id = ?').get(subgroupId) as Subgroup | undefined;
  },

  getPartsForSubgroup(subgroupId: string): PartWithDiagram[] {
    return db.prepare(`
      SELECT p.*, d.image_path
      FROM parts p
      JOIN diagrams d ON p.diagram_id = d.id
      WHERE p.subgroup_id = ?
      ORDER BY p.ref_number, p.part_number
    `).all(subgroupId) as PartWithDiagram[];
  },

  getPartsForGroup(groupId: string): PartWithDiagram[] {
    return db.prepare(`
      SELECT p.*, d.image_path
      FROM parts p
      JOIN diagrams d ON p.diagram_id = d.id
      WHERE p.group_id = ? AND p.subgroup_id IS NULL
      ORDER BY p.ref_number, p.part_number
    `).all(groupId) as PartWithDiagram[];
  },

  getDiagram(diagramId: string): Diagram | undefined {
    return db.prepare('SELECT * FROM diagrams WHERE id = ?').get(diagramId) as Diagram | undefined;
  },

  getDiagramForSubgroup(subgroupId: string): Diagram | undefined {
    return db.prepare('SELECT * FROM diagrams WHERE subgroup_id = ? LIMIT 1')
      .get(subgroupId) as Diagram | undefined;
  },

  getPart(partId: number): PartWithDiagram | undefined {
    return db.prepare(`
      SELECT p.*, d.image_path
      FROM parts p
      JOIN diagrams d ON p.diagram_id = d.id
      WHERE p.id = ?
    `).get(partId) as PartWithDiagram | undefined;
  },

  searchParts(query: string): SearchResult[] {
    if (!query.trim()) return [];
    return db.prepare(`
      SELECT p.*, d.image_path, g.name as group_name, s.name as subgroup_name
      FROM parts p
      JOIN parts_fts fts ON p.id = fts.rowid
      JOIN diagrams d ON p.diagram_id = d.id
      JOIN groups g ON p.group_id = g.id
      LEFT JOIN subgroups s ON p.subgroup_id = s.id
      WHERE parts_fts MATCH ?
      ORDER BY rank
      LIMIT 50
    `).all(query + '*') as SearchResult[];
  },
};
```

**Step 3: Test database connection**

Update `tui/src/index.tsx`:

```tsx
import React from 'react';
import { render, Text } from 'ink';
import { queries } from './db.js';

function App() {
  const groups = queries.getGroups();
  return <Text>Found {groups.length} groups</Text>;
}

render(<App />);
```

**Step 4: Verify it connects**

Run: `cd tui && npm start`
Expected: "Found N groups" where N > 0

**Step 5: Commit**

```bash
git add tui/src/db.ts tui/src/types.ts tui/src/index.tsx
git commit -m "feat(tui): add database layer with queries"
```

---

## Task 3: Navigation State & App Shell

**Files:**
- Create: `tui/src/state.ts`
- Modify: `tui/src/index.tsx`

**Step 1: Create navigation state**

```typescript
// tui/src/state.ts
export type Screen =
  | { type: 'home' }
  | { type: 'group'; groupId: string }
  | { type: 'subgroup'; subgroupId: string; selectedPartId?: number }
  | { type: 'partDetail'; partId: number; fromSearch?: boolean }
  | { type: 'search'; query: string; selectedPartId?: number };

export interface AppState {
  screen: Screen;
  history: Screen[];
}

export function initialState(): AppState {
  return {
    screen: { type: 'home' },
    history: [],
  };
}

export function navigate(state: AppState, to: Screen): AppState {
  return {
    screen: to,
    history: [...state.history, state.screen],
  };
}

export function goBack(state: AppState): AppState {
  if (state.history.length === 0) {
    return state;
  }
  const history = [...state.history];
  const screen = history.pop()!;
  return { screen, history };
}
```

**Step 2: Create App shell with navigation**

```tsx
// tui/src/index.tsx
import React, { useState, useCallback } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import { initialState, navigate, goBack, type Screen, type AppState } from './state.js';

function App() {
  const { exit } = useApp();
  const [state, setState] = useState<AppState>(initialState);

  const navigateTo = useCallback((screen: Screen) => {
    setState(s => navigate(s, screen));
  }, []);

  const back = useCallback(() => {
    setState(s => goBack(s));
  }, []);

  useInput((input, key) => {
    if (input === 'q') {
      exit();
    }
    if (key.escape) {
      if (state.history.length > 0) {
        back();
      } else {
        exit();
      }
    }
  });

  return (
    <Box flexDirection="column">
      <Text color="cyan" bold>DELICA PARTS</Text>
      <Text dimColor>Screen: {state.screen.type}</Text>
      <Text dimColor>History depth: {state.history.length}</Text>
      <Text dimColor>Press q to quit, esc to go back</Text>
    </Box>
  );
}

render(<App />);
```

**Step 3: Verify navigation shell**

Run: `cd tui && npm start`
Expected: Shows screen type "home", q quits

**Step 4: Commit**

```bash
git add tui/src/state.ts tui/src/index.tsx
git commit -m "feat(tui): add navigation state management"
```

---

## Task 4: UI Components - Menu

**Files:**
- Create: `tui/src/components/ui/Menu.tsx`
- Create: `tui/src/components/ui/index.ts`

**Step 1: Create Menu component**

```tsx
// tui/src/components/ui/Menu.tsx
import React from 'react';
import { Box, Text, useInput } from 'ink';

export interface MenuItem {
  id: string;
  label: string;
  hint?: string;
}

interface MenuProps {
  items: MenuItem[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onSubmit: (item: MenuItem) => void;
}

export function Menu({ items, selectedIndex, onSelect, onSubmit }: MenuProps) {
  useInput((input, key) => {
    if (key.upArrow || input === 'k') {
      onSelect(Math.max(0, selectedIndex - 1));
    }
    if (key.downArrow || input === 'j') {
      onSelect(Math.min(items.length - 1, selectedIndex + 1));
    }
    if (key.return) {
      if (items[selectedIndex]) {
        onSubmit(items[selectedIndex]);
      }
    }
  });

  return (
    <Box flexDirection="column">
      {items.map((item, index) => (
        <Box key={item.id}>
          <Text color={index === selectedIndex ? 'green' : undefined}>
            {index === selectedIndex ? '› ' : '  '}
          </Text>
          <Text color={index === selectedIndex ? 'yellow' : 'white'} bold={index === selectedIndex}>
            {item.label}
          </Text>
          {item.hint && (
            <Text dimColor> {item.hint}</Text>
          )}
        </Box>
      ))}
    </Box>
  );
}
```

**Step 2: Create barrel export**

```typescript
// tui/src/components/ui/index.ts
export { Menu, type MenuItem } from './Menu.js';
```

**Step 3: Commit**

```bash
git add tui/src/components/
git commit -m "feat(tui): add Menu component"
```

---

## Task 5: Home Screen

**Files:**
- Create: `tui/src/components/Home.tsx`
- Modify: `tui/src/index.tsx`

**Step 1: Create Home component**

```tsx
// tui/src/components/Home.tsx
import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { queries } from '../db.js';
import { Menu, type MenuItem } from './ui/index.js';
import type { Screen } from '../state.js';

const VEHICLE = {
  name: '1999 Mitsubishi Delica Space Gear',
  frame: 'PD6W-0500900',
  exterior: 'W09M',
  interior: '57A',
};

interface HomeProps {
  onNavigate: (screen: Screen) => void;
}

export function Home({ onNavigate }: HomeProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const menuItems = useMemo((): MenuItem[] => {
    const groups = queries.getGroups();
    return [
      { id: '__search__', label: '/ Search', hint: 'Find parts by number or name' },
      ...groups.map(g => ({ id: g.id, label: g.name })),
    ];
  }, []);

  useInput((input) => {
    if (input === '/') {
      onNavigate({ type: 'search', query: '' });
    }
  });

  const handleSubmit = (item: MenuItem) => {
    if (item.id === '__search__') {
      onNavigate({ type: 'search', query: '' });
    } else {
      onNavigate({ type: 'group', groupId: item.id });
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="cyan" bold>DELICA PARTS</Text>
      <Text> </Text>

      <Box borderStyle="single" paddingX={1} flexDirection="column">
        <Text bold>{VEHICLE.name}</Text>
        <Text>Frame: {VEHICLE.frame}</Text>
        <Text>Exterior: {VEHICLE.exterior}   Interior: {VEHICLE.interior}</Text>
      </Box>

      <Text> </Text>

      <Menu
        items={menuItems}
        selectedIndex={selectedIndex}
        onSelect={setSelectedIndex}
        onSubmit={handleSubmit}
      />

      <Text> </Text>
      <Text dimColor>↑↓ navigate   enter select   / search   q quit</Text>
    </Box>
  );
}
```

**Step 2: Wire up Home to App**

```tsx
// tui/src/index.tsx
import React, { useState, useCallback } from 'react';
import { render, Box, useInput, useApp } from 'ink';
import { initialState, navigate, goBack, type Screen, type AppState } from './state.js';
import { Home } from './components/Home.js';

function App() {
  const { exit } = useApp();
  const [state, setState] = useState<AppState>(initialState);

  const navigateTo = useCallback((screen: Screen) => {
    setState(s => navigate(s, screen));
  }, []);

  const back = useCallback(() => {
    setState(s => {
      const newState = goBack(s);
      if (newState === s) {
        exit();
        return s;
      }
      return newState;
    });
  }, [exit]);

  useInput((input, key) => {
    if (input === 'q') {
      exit();
    }
    if (key.escape) {
      back();
    }
  });

  const { screen } = state;

  return (
    <Box flexDirection="column">
      {screen.type === 'home' && (
        <Home onNavigate={navigateTo} />
      )}
      {screen.type !== 'home' && (
        <Box padding={1}>
          <Box flexDirection="column">
            <Text color="cyan" bold>TODO: {screen.type}</Text>
            <Text dimColor>Press esc to go back</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}

render(<App />);
```

**Step 3: Verify Home screen**

Run: `cd tui && npm start`
Expected: Vehicle info box, groups list, can navigate with j/k, enter shows TODO

**Step 4: Commit**

```bash
git add tui/src/components/Home.tsx tui/src/index.tsx
git commit -m "feat(tui): add Home screen with vehicle info and groups menu"
```

---

## Task 6: Group View (Subgroups Menu)

**Files:**
- Create: `tui/src/components/GroupView.tsx`
- Modify: `tui/src/index.tsx`

**Step 1: Create GroupView component**

```tsx
// tui/src/components/GroupView.tsx
import React, { useState, useMemo } from 'react';
import { Box, Text } from 'ink';
import { queries } from '../db.js';
import { Menu, type MenuItem } from './ui/index.js';
import type { Screen } from '../state.js';

interface GroupViewProps {
  groupId: string;
  onNavigate: (screen: Screen) => void;
}

export function GroupView({ groupId, onNavigate }: GroupViewProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const group = useMemo(() => queries.getGroup(groupId), [groupId]);
  const subgroups = useMemo(() => queries.getSubgroups(groupId), [groupId]);

  const menuItems = useMemo((): MenuItem[] => {
    return subgroups.map(s => ({ id: s.id, label: s.name }));
  }, [subgroups]);

  const handleSubmit = (item: MenuItem) => {
    onNavigate({ type: 'subgroup', subgroupId: item.id });
  };

  if (!group) {
    return <Text color="red">Group not found: {groupId}</Text>;
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box>
        <Text color="cyan" bold>{group.name.toUpperCase()}</Text>
        <Box flexGrow={1} />
        <Text dimColor>esc back</Text>
      </Box>

      <Text> </Text>

      {menuItems.length === 0 ? (
        <Text dimColor>No subgroups found</Text>
      ) : (
        <Menu
          items={menuItems}
          selectedIndex={selectedIndex}
          onSelect={setSelectedIndex}
          onSubmit={handleSubmit}
        />
      )}

      <Text> </Text>
      <Text dimColor>↑↓ navigate   enter select</Text>
    </Box>
  );
}
```

**Step 2: Wire up to App**

Update `tui/src/index.tsx` render section:

```tsx
  return (
    <Box flexDirection="column">
      {screen.type === 'home' && (
        <Home onNavigate={navigateTo} />
      )}
      {screen.type === 'group' && (
        <GroupView groupId={screen.groupId} onNavigate={navigateTo} />
      )}
      {screen.type !== 'home' && screen.type !== 'group' && (
        <Box padding={1}>
          <Box flexDirection="column">
            <Text color="cyan" bold>TODO: {screen.type}</Text>
            <Text dimColor>Press esc to go back</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
```

Add import: `import { GroupView } from './components/GroupView.js';`

**Step 3: Verify group navigation**

Run: `cd tui && npm start`
Expected: Select a group, see its subgroups, esc goes back to home

**Step 4: Commit**

```bash
git add tui/src/components/GroupView.tsx tui/src/index.tsx
git commit -m "feat(tui): add GroupView screen for subgroups"
```

---

## Task 7: Split Pane Layout

**Files:**
- Create: `tui/src/components/ui/SplitPane.tsx`
- Modify: `tui/src/components/ui/index.ts`

**Step 1: Create SplitPane component**

```tsx
// tui/src/components/ui/SplitPane.tsx
import React from 'react';
import { Box } from 'ink';

interface SplitPaneProps {
  left: React.ReactNode;
  right: React.ReactNode;
  leftWidth?: string;
}

export function SplitPane({ left, right, leftWidth = '40%' }: SplitPaneProps) {
  return (
    <Box flexDirection="row" flexGrow={1}>
      <Box width={leftWidth} flexDirection="column" marginRight={1}>
        {left}
      </Box>
      <Box flexDirection="column" borderStyle="single" borderLeft borderTop={false} borderRight={false} borderBottom={false} paddingLeft={1} flexGrow={1}>
        {right}
      </Box>
    </Box>
  );
}
```

**Step 2: Update barrel export**

```typescript
// tui/src/components/ui/index.ts
export { Menu, type MenuItem } from './Menu.js';
export { SplitPane } from './SplitPane.js';
```

**Step 3: Commit**

```bash
git add tui/src/components/ui/
git commit -m "feat(tui): add SplitPane layout component"
```

---

## Task 8: Diagram Image Component

**Files:**
- Create: `tui/src/components/DiagramImage.tsx`

**Step 1: Create DiagramImage component**

```tsx
// tui/src/components/DiagramImage.tsx
import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import terminalImage from 'terminal-image';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const imagesDir = path.resolve(__dirname, '../../data/images');

interface DiagramImageProps {
  imagePath: string | null;
  diagramId?: string;
  width?: number;
  height?: number;
}

export function DiagramImage({ imagePath, diagramId, width = 40, height = 15 }: DiagramImageProps) {
  const [imageOutput, setImageOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!imagePath) {
      setImageOutput(null);
      setError(null);
      return;
    }

    const fullPath = path.resolve(imagesDir, imagePath);

    if (!fs.existsSync(fullPath)) {
      setError(`File not found: ${imagePath}`);
      return;
    }

    (async () => {
      try {
        const image = await terminalImage.file(fullPath, {
          width,
          height,
          preserveAspectRatio: true,
        });
        setImageOutput(image);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to render image');
      }
    })();
  }, [imagePath, width, height]);

  if (!imagePath) {
    return (
      <Box
        width={width}
        height={height}
        borderStyle="single"
        alignItems="center"
        justifyContent="center"
      >
        <Text dimColor>No diagram</Text>
      </Box>
    );
  }

  if (error) {
    return (
      <Box flexDirection="column">
        <Box
          width={width}
          height={height}
          borderStyle="single"
          alignItems="center"
          justifyContent="center"
        >
          <Text color="red">{error}</Text>
        </Box>
        <Text dimColor>{diagramId || imagePath}</Text>
      </Box>
    );
  }

  if (!imageOutput) {
    return (
      <Box flexDirection="column">
        <Box
          width={width}
          height={height}
          borderStyle="single"
          alignItems="center"
          justifyContent="center"
        >
          <Text dimColor>Loading...</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text>{imageOutput}</Text>
      {diagramId && <Text dimColor>{diagramId}</Text>}
    </Box>
  );
}
```

**Step 2: Commit**

```bash
git add tui/src/components/DiagramImage.tsx
git commit -m "feat(tui): add DiagramImage component with Kitty protocol"
```

---

## Task 9: Subgroup View (Parts List with Diagram)

**Files:**
- Create: `tui/src/components/SubgroupView.tsx`
- Modify: `tui/src/index.tsx`

**Step 1: Create SubgroupView component**

```tsx
// tui/src/components/SubgroupView.tsx
import React, { useState, useMemo } from 'react';
import { Box, Text } from 'ink';
import { queries } from '../db.js';
import { Menu, type MenuItem, SplitPane } from './ui/index.js';
import { DiagramImage } from './DiagramImage.js';
import type { Screen } from '../state.js';

interface SubgroupViewProps {
  subgroupId: string;
  onNavigate: (screen: Screen) => void;
}

export function SubgroupView({ subgroupId, onNavigate }: SubgroupViewProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const subgroup = useMemo(() => queries.getSubgroup(subgroupId), [subgroupId]);
  const group = useMemo(() => subgroup ? queries.getGroup(subgroup.group_id) : null, [subgroup]);
  const parts = useMemo(() => queries.getPartsForSubgroup(subgroupId), [subgroupId]);
  const diagram = useMemo(() => queries.getDiagramForSubgroup(subgroupId), [subgroupId]);

  const menuItems = useMemo((): MenuItem[] => {
    return parts.map(p => ({
      id: String(p.id),
      label: p.part_number,
      hint: p.description || undefined,
    }));
  }, [parts]);

  const handleSubmit = (item: MenuItem) => {
    onNavigate({ type: 'partDetail', partId: Number(item.id) });
  };

  if (!subgroup || !group) {
    return <Text color="red">Subgroup not found: {subgroupId}</Text>;
  }

  const breadcrumb = `${group.name.toUpperCase()} › ${subgroup.name}`;

  return (
    <Box flexDirection="column" padding={1}>
      <Box>
        <Text color="cyan" bold>{breadcrumb}</Text>
        <Box flexGrow={1} />
        <Text dimColor>esc back</Text>
      </Box>

      <Text> </Text>

      <SplitPane
        left={
          <DiagramImage
            imagePath={diagram?.image_path || null}
            diagramId={diagram?.id}
          />
        }
        right={
          <Box flexDirection="column">
            <Box>
              <Text color="cyan" bold>PARTS</Text>
              <Box flexGrow={1} />
              <Text color="magenta">{parts.length}</Text>
            </Box>
            <Text dimColor>─────────────────────────────────</Text>
            <Text> </Text>

            {menuItems.length === 0 ? (
              <Text dimColor>No parts found</Text>
            ) : (
              <Menu
                items={menuItems}
                selectedIndex={selectedIndex}
                onSelect={setSelectedIndex}
                onSubmit={handleSubmit}
              />
            )}

            <Text> </Text>
            <Text dimColor>↑↓ navigate   enter select</Text>
          </Box>
        }
      />
    </Box>
  );
}
```

**Step 2: Wire up to App**

Update `tui/src/index.tsx` imports and render:

```tsx
import { SubgroupView } from './components/SubgroupView.js';

// In render:
{screen.type === 'subgroup' && (
  <SubgroupView subgroupId={screen.subgroupId} onNavigate={navigateTo} />
)}
```

**Step 3: Verify subgroup view**

Run: `cd tui && npm start`
Expected: Navigate to a subgroup, see diagram (or placeholder) on left, parts list on right

**Step 4: Commit**

```bash
git add tui/src/components/SubgroupView.tsx tui/src/index.tsx
git commit -m "feat(tui): add SubgroupView with split pane diagram and parts list"
```

---

## Task 10: Part Detail View

**Files:**
- Create: `tui/src/components/PartDetail.tsx`
- Modify: `tui/src/index.tsx`

**Step 1: Create PartDetail component**

```tsx
// tui/src/components/PartDetail.tsx
import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { queries } from '../db.js';
import { SplitPane } from './ui/index.js';
import { DiagramImage } from './DiagramImage.js';

interface PartDetailProps {
  partId: number;
}

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined) return null;
  return (
    <Box>
      <Box width={16}>
        <Text dimColor>{label}</Text>
      </Box>
      <Text>{value}</Text>
    </Box>
  );
}

export function PartDetail({ partId }: PartDetailProps) {
  const part = useMemo(() => queries.getPart(partId), [partId]);
  const diagram = useMemo(() => part ? queries.getDiagram(part.diagram_id) : null, [part]);
  const group = useMemo(() => part ? queries.getGroup(part.group_id) : null, [part]);
  const subgroup = useMemo(() => part?.subgroup_id ? queries.getSubgroup(part.subgroup_id) : null, [part]);

  if (!part) {
    return <Text color="red">Part not found: {partId}</Text>;
  }

  const breadcrumb = subgroup
    ? `${group?.name.toUpperCase() || ''} › ${subgroup.name}`
    : group?.name.toUpperCase() || '';

  const priceFormatted = part.price_usd ? `$${part.price_usd.toFixed(2)}` : null;

  return (
    <Box flexDirection="column" padding={1}>
      <Box>
        <Text color="cyan" bold>{breadcrumb}</Text>
        <Box flexGrow={1} />
        <Text dimColor>esc back</Text>
      </Box>

      <Text> </Text>

      <SplitPane
        left={
          <DiagramImage
            imagePath={part.image_path}
            diagramId={diagram?.id}
          />
        }
        right={
          <Box flexDirection="column">
            <Text color="yellow" bold>{part.part_number}</Text>
            <Text>{part.description || 'No description'}</Text>
            <Text> </Text>
            <Text dimColor>─────────────────────────────────</Text>
            <Text> </Text>

            <Field label="PNC" value={part.pnc} />
            <Field label="Ref #" value={part.ref_number} />
            <Field label="Quantity" value={part.quantity} />
            <Field label="Price" value={priceFormatted} />
            <Field label="Spec" value={part.spec} />
            <Field label="Color" value={part.color} />
            <Field label="Date Range" value={part.model_date_range} />
            <Field label="Replaces" value={part.replacement_part_number} />
            {part.notes && (
              <>
                <Text> </Text>
                <Text dimColor>Notes:</Text>
                <Text>{part.notes}</Text>
              </>
            )}

            <Text> </Text>
            <Text dimColor>esc back</Text>
          </Box>
        }
      />
    </Box>
  );
}
```

**Step 2: Wire up to App**

Update `tui/src/index.tsx`:

```tsx
import { PartDetail } from './components/PartDetail.js';

// In render:
{screen.type === 'partDetail' && (
  <PartDetail partId={screen.partId} />
)}
```

**Step 3: Verify part detail**

Run: `cd tui && npm start`
Expected: Navigate to a part, see diagram on left, part details on right

**Step 4: Commit**

```bash
git add tui/src/components/PartDetail.tsx tui/src/index.tsx
git commit -m "feat(tui): add PartDetail view with diagram and part info"
```

---

## Task 11: Search Screen

**Files:**
- Create: `tui/src/components/Search.tsx`
- Modify: `tui/src/index.tsx`

**Step 1: Create Search component**

```tsx
// tui/src/components/Search.tsx
import React, { useState, useMemo, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { queries } from '../db.js';
import { Menu, type MenuItem } from './ui/index.js';
import type { Screen, SearchResult } from '../state.js';

interface SearchProps {
  initialQuery: string;
  onNavigate: (screen: Screen) => void;
}

export function Search({ initialQuery, onNavigate }: SearchProps) {
  const [query, setQuery] = useState(initialQuery);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
      setSelectedIndex(0);
    }, 150);
    return () => clearTimeout(timer);
  }, [query]);

  const results = useMemo(() => {
    if (!debouncedQuery.trim()) return [];
    return queries.searchParts(debouncedQuery);
  }, [debouncedQuery]);

  const menuItems = useMemo((): MenuItem[] => {
    return results.map(r => ({
      id: String(r.id),
      label: r.part_number,
      hint: `${r.description || ''} — ${r.subgroup_name || r.group_name}`.trim(),
    }));
  }, [results]);

  useInput((input, key) => {
    if (key.upArrow || (input === 'k' && !query)) {
      setSelectedIndex(Math.max(0, selectedIndex - 1));
    }
    if (key.downArrow || (input === 'j' && !query)) {
      setSelectedIndex(Math.min(menuItems.length - 1, selectedIndex + 1));
    }
    if (key.return && menuItems[selectedIndex]) {
      onNavigate({ type: 'partDetail', partId: Number(menuItems[selectedIndex].id), fromSearch: true });
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box>
        <Text color="cyan" bold>SEARCH</Text>
        <Box flexGrow={1} />
        <Text dimColor>esc back</Text>
      </Box>

      <Text> </Text>

      <Box borderStyle="single" paddingX={1}>
        <TextInput
          value={query}
          onChange={setQuery}
          placeholder="Search parts by number or description..."
        />
      </Box>

      <Text> </Text>
      <Text dimColor>───────────────────────────────────────────────────────</Text>
      <Text> </Text>

      {!debouncedQuery.trim() ? (
        <Text dimColor>Start typing to search parts, tags, or descriptions</Text>
      ) : menuItems.length === 0 ? (
        <Text dimColor>No results for "{debouncedQuery}"</Text>
      ) : (
        <>
          {menuItems.map((item, index) => (
            <Box key={item.id}>
              <Text color={index === selectedIndex ? 'green' : undefined}>
                {index === selectedIndex ? '› ' : '  '}
              </Text>
              <Box width={14}>
                <Text color={index === selectedIndex ? 'yellow' : 'white'} bold={index === selectedIndex}>
                  {item.label}
                </Text>
              </Box>
              <Text dimColor>{item.hint}</Text>
            </Box>
          ))}
          <Text> </Text>
          <Text dimColor>{results.length} results</Text>
        </>
      )}

      <Text> </Text>
      <Text dimColor>↑↓ select   enter view</Text>
    </Box>
  );
}
```

**Step 2: Wire up to App**

Update `tui/src/index.tsx`:

```tsx
import { Search } from './components/Search.js';

// In render:
{screen.type === 'search' && (
  <Search initialQuery={screen.query} onNavigate={navigateTo} />
)}
```

**Step 3: Verify search**

Run: `cd tui && npm start`
Expected: Press /, type a query, see results, enter navigates to part detail

**Step 4: Commit**

```bash
git add tui/src/components/Search.tsx tui/src/index.tsx
git commit -m "feat(tui): add Search screen with FTS and auto-complete"
```

---

## Task 12: Final Cleanup & Root Script

**Files:**
- Modify: `tui/src/index.tsx` (remove placeholder)
- Modify: `deno.json` (add tui task)

**Step 1: Clean up App component**

Final `tui/src/index.tsx`:

```tsx
import React, { useState, useCallback } from 'react';
import { render, Box, useInput, useApp } from 'ink';
import { initialState, navigate, goBack, type Screen, type AppState } from './state.js';
import { Home } from './components/Home.js';
import { GroupView } from './components/GroupView.js';
import { SubgroupView } from './components/SubgroupView.js';
import { PartDetail } from './components/PartDetail.js';
import { Search } from './components/Search.js';

function App() {
  const { exit } = useApp();
  const [state, setState] = useState<AppState>(initialState);

  const navigateTo = useCallback((screen: Screen) => {
    setState(s => navigate(s, screen));
  }, []);

  const back = useCallback(() => {
    setState(s => {
      const newState = goBack(s);
      if (newState === s) {
        exit();
        return s;
      }
      return newState;
    });
  }, [exit]);

  useInput((input, key) => {
    if (input === 'q') {
      exit();
    }
    if (key.escape) {
      back();
    }
  });

  const { screen } = state;

  return (
    <Box flexDirection="column">
      {screen.type === 'home' && <Home onNavigate={navigateTo} />}
      {screen.type === 'group' && <GroupView groupId={screen.groupId} onNavigate={navigateTo} />}
      {screen.type === 'subgroup' && <SubgroupView subgroupId={screen.subgroupId} onNavigate={navigateTo} />}
      {screen.type === 'partDetail' && <PartDetail partId={screen.partId} />}
      {screen.type === 'search' && <Search initialQuery={screen.query} onNavigate={navigateTo} />}
    </Box>
  );
}

render(<App />);
```

**Step 2: Add tui task to root deno.json**

Add to `deno.json` tasks:

```json
"tui": "cd tui && npm start"
```

**Step 3: Verify everything works**

Run: `deno task tui`
Expected: Full TUI with all navigation working

**Step 4: Commit**

```bash
git add tui/src/index.tsx deno.json
git commit -m "feat(tui): complete TUI with all screens and root task"
```

---

## Task 13: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add TUI section to CLAUDE.md**

Add after the Commands section:

```markdown
## TUI

Terminal user interface for browsing parts:

```bash
deno task tui    # Start the TUI (requires npm install in tui/)
```

Or directly:
```bash
cd tui && npm start
```

### TUI Structure

```
tui/
├── src/
│   ├── index.tsx       # App entry and navigation
│   ├── db.ts           # SQLite queries (reads ../data/delica.db)
│   ├── state.ts        # Navigation state management
│   └── components/
│       ├── Home.tsx        # Vehicle info + groups menu
│       ├── GroupView.tsx   # Subgroups menu
│       ├── SubgroupView.tsx # Split: diagram + parts list
│       ├── PartDetail.tsx  # Split: diagram + part info
│       ├── Search.tsx      # FTS search with auto-complete
│       └── ui/             # Menu, SplitPane components
```

### Navigation

- `↑/↓` or `j/k` — navigate menus
- `Enter` — select
- `Esc` — go back
- `/` — search (from any screen)
- `q` — quit
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add TUI section to CLAUDE.md"
```
