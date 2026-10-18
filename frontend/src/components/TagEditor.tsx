import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

export default function TagEditor({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');

  const add = () => {
    const value = draft.trim().replace(/^#/, '');
    if (value && !tags.includes(value)) onChange([...tags, value]);
    setDraft('');
  };

  return (
    <div className="tags">
      {tags.map((tag) => (
        <span key={tag} className="chip">
          #{tag}
          <button type="button" onClick={() => onChange(tags.filter((x) => x !== tag))} aria-label={t('tags.remove', { tag })}>
            <X size={12} />
          </button>
        </span>
      ))}
      <input
        className="tag-input"
        value={draft}
        placeholder={t('tags.add')}
        aria-label={t('tags.add')}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
      />
    </div>
  );
}
