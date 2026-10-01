import type { Status } from './api';

export const colors = {
  bg: '#F6F5F2',
  card: '#FFFFFF',
  text: '#1C1B19',
  muted: '#6B6862',
  border: '#E4E1DA',
  primary: '#3D5AFE',
  primaryText: '#FFFFFF',
  danger: '#D93838',
  gold: '#B7791F',
  goldBg: '#FDF3DC',
};

export const statusMeta: Record<Status, { label: string; color: string; bg: string }> = {
  focused: { label: 'Focused', color: '#2F7D4F', bg: '#E3F3E9' },
  on_break: { label: 'On break', color: '#B26A00', bg: '#FDF0DC' },
  absent: { label: 'Absent', color: '#6B6862', bg: '#EDEBE6' },
};
