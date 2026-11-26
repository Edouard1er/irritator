import { memo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { LakeCell } from '@/lib/simulation/lake-exploration';
import styles from './logistic-spatial.module.css';

export const maxLakeComparisons = 10;
const resultLimit = 8;

export const LakeTrajectoryPicker = memo(function LakeTrajectoryPicker({ cells, selected, colors, select, add, remove, fixed }: {
  cells: readonly LakeCell[]; selected: string; colors: ReadonlyMap<string, string>;
  select: (id: string) => void; add: (id: string) => void; remove: (id: string) => void;
  fixed?: readonly string[] | undefined;
}) {
  const [query, setQuery] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);
  const search = query.trim().toUpperCase();
  const matches = search ? cells.filter(cell => cell.id.toUpperCase().includes(search)) : [];
  const selectedColor = colors.get(selected);
  const pinned = fixed ?? [selected];
  const compared = [...colors].filter(([id]) => !pinned.includes(id));
  const full = compared.length >= maxLakeComparisons;

  function consult(id: string) {
    select(id);
    clearSearch();
  }

  function clearSearch() {
    setQuery('');
    searchInput.current?.focus();
  }

  return <fieldset className={styles.lakePicker}>
    <legend>Comparer les trajectoires</legend>
    <div className={styles.lakeChips}>
      {!fixed && selectedColor && <span data-picker-cell={selected} className={styles.lakeChip}
        style={{ color: selectedColor }}>Cellule consultée · {selected}</span>}
      {fixed?.map(id => <span key={id} data-picker-cell={id} className={styles.lakeChip} style={{ color: colors.get(id) }}>{id}</span>)}
      {compared.map(([id, color]) =>
        <button type="button" key={id} data-picker-cell={id} className={styles.lakeChip}
          aria-label={`Retirer ${id} de la comparaison`} style={{ color }}
          onClick={() => { remove(id); searchInput.current?.focus(); }}>
          {id} <X size={13} aria-hidden="true" />
        </button>)}
    </div>
    <label className={styles.lakeSearch}>
      <Search size={15} aria-hidden="true" />
      <input ref={searchInput} type="search" aria-label="Rechercher une cellule par identifiant"
        placeholder="Identifiant de cellule" value={query}
        onChange={event => setQuery(event.currentTarget.value)}
        onKeyDown={event => {
          if (event.key !== 'Enter') return;
          const cell = matches.find(match => match.id.toUpperCase() === search) ?? (matches.length === 1 ? matches[0] : undefined);
          if (cell) { event.preventDefault(); consult(cell.id); }
        }} />
    </label>
    <p className={styles.coverage} aria-live="polite">
      {compared.length} / {maxLakeComparisons} cellules supplémentaires
      {search && (matches.length === 0 ? ' · Aucune cellule trouvée'
        : matches.length > resultLimit ? ` · ${matches.length} résultats, affinez la recherche` : '')}
    </p>
    {matches.length > 0 && <ul className={styles.lakeSearchResults} aria-label="Cellules trouvées">
      {matches.slice(0, resultLimit).map(({ id }) => <li key={id}>
        <strong>{id}</strong>
        <button type="button" disabled={id === selected} aria-label={`Consulter ${id}`} onClick={() => consult(id)}>Consulter</button>
        <button type="button" disabled={full || colors.has(id)} aria-label={`Comparer ${id}`}
          onClick={() => { add(id); clearSearch(); }}>Ajouter</button>
      </li>)}
    </ul>}
  </fieldset>;
});
