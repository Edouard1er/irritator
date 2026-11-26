import { memo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { LakeCell } from '@/lib/simulation/lake-exploration';
import { logisticSeriesColor } from './logistic-trajectories';
import styles from './logistic-spatial.module.css';

export const maxLakeComparisons = 3;
const resultLimit = 8;

export const LakeTrajectoryPicker = memo(function LakeTrajectoryPicker({ cells, selected, compared, select, add, remove }: {
  cells: readonly LakeCell[]; selected: string; compared: readonly string[];
  select: (id: string) => void; add: (id: string) => void; remove: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);
  const search = query.trim().toUpperCase();
  const matches = search ? cells.filter(cell => cell.id.toUpperCase().includes(search)) : [];
  const selectedCell = cells.find(cell => cell.id === selected);
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
      {selectedCell && <span data-picker-cell={selected} className={styles.lakeChip}
        style={{ color: logisticSeriesColor(selectedCell) }}>Cellule consultée · {selected}</span>}
      {compared.map(id => {
        const cell = cells.find(item => item.id === id);
        return cell && <button type="button" key={id} data-picker-cell={id} className={styles.lakeChip}
          aria-label={`Retirer ${id} de la comparaison`} style={{ color: logisticSeriesColor(cell) }}
          onClick={() => { remove(id); searchInput.current?.focus(); }}>
          {id} <X size={13} aria-hidden="true" />
        </button>;
      })}
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
        <button type="button" disabled={id === selected || full || compared.includes(id)} aria-label={`Comparer ${id}`}
          onClick={() => { add(id); clearSearch(); }}>Ajouter</button>
      </li>)}
    </ul>}
  </fieldset>;
});
