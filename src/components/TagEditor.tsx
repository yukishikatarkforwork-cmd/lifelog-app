import { useState } from 'react';

const SUGGESTED = ['外食', '自炊', '間食', '脂質多め', '高たんぱく', '飲み物'];

export default function TagEditor({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [input, setInput] = useState('');

  const add = (raw: string) => {
    const t = raw.trim();
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setInput('');
  };
  const remove = (t: string) => onChange(tags.filter((x) => x !== t));

  return (
    <div>
      <div className="tag-input" style={{ marginBottom: 8 }}>
        {tags.map((t) => (
          <span key={t} className="chip">
            {t}
            <button type="button" onClick={() => remove(t)} aria-label="削除">×</button>
          </span>
        ))}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add(input);
            }
          }}
          placeholder="タグを追加"
          style={{ flex: '1 0 100px', minWidth: 80, padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 8 }}
        />
      </div>
      <div className="tag-input">
        {SUGGESTED.filter((s) => !tags.includes(s)).map((s) => (
          <button key={s} type="button" className="tag" style={{ cursor: 'pointer', border: 'none' }} onClick={() => add(s)}>
            + {s}
          </button>
        ))}
      </div>
    </div>
  );
}
