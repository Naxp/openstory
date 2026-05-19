import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  detectMentionTrigger,
  insertMention,
  type MentionTrigger,
} from './mention-trigger';
import {
  filterMentionItems,
  SECTION_LABELS,
  SECTION_ORDER,
  type MentionItem,
  type MentionSection,
} from './mention-items';

type PromptMentionTextareaProps = Omit<
  React.ComponentProps<typeof Textarea>,
  'value' | 'onChange' | 'ref'
> & {
  value: string;
  onChange: (value: string) => void;
  mentionItems: MentionItem[];
  ref?: React.Ref<HTMLTextAreaElement>;
};

const MAX_ITEMS = 8;

export const PromptMentionTextarea: React.FC<PromptMentionTextareaProps> = ({
  value,
  onChange,
  mentionItems,
  onKeyDown,
  onSelect,
  className,
  ref,
  ...props
}) => {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useImperativeHandle(ref, () => {
    const t = textareaRef.current;
    if (!t) throw new Error('PromptMentionTextarea ref accessed before mount');
    return t;
  });

  const [trigger, setTrigger] = useState<MentionTrigger | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);

  const refreshTrigger = useCallback((text: string, caret: number) => {
    const next = detectMentionTrigger(text, caret);
    setTrigger(next);
    setActiveIdx(0);
  }, []);

  // Sectioned & filtered items, capped at MAX_ITEMS total for popover height.
  const visibleItems = useMemo(() => {
    if (!trigger) return [] as MentionItem[];
    const filtered = filterMentionItems(mentionItems, trigger.query);
    const grouped: MentionItem[] = [];
    for (const section of SECTION_ORDER) {
      for (const item of filtered) {
        if (item.section === section) grouped.push(item);
      }
    }
    return grouped.slice(0, MAX_ITEMS);
  }, [mentionItems, trigger]);

  const open = trigger !== null && visibleItems.length > 0;

  // Clamp active index whenever the visible list shrinks.
  useEffect(() => {
    if (activeIdx >= visibleItems.length && visibleItems.length > 0) {
      setActiveIdx(0);
    }
  }, [visibleItems.length, activeIdx]);

  const commit = useCallback(
    (item: MentionItem) => {
      const ta = textareaRef.current;
      if (!ta || !trigger) return;
      const next = insertMention(value, trigger, ta.selectionEnd, item.tag);
      onChange(next.text);
      setTrigger(null);
      // Restore caret after React re-renders the value.
      requestAnimationFrame(() => {
        const t = textareaRef.current;
        if (!t) return;
        t.focus();
        t.setSelectionRange(next.caret, next.caret);
      });
    },
    [onChange, trigger, value]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (open) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setActiveIdx((i) => (i + 1) % visibleItems.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setActiveIdx((i) => (i === 0 ? visibleItems.length - 1 : i - 1));
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          const item = visibleItems[activeIdx];
          if (item) {
            e.preventDefault();
            commit(item);
            return;
          }
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setTrigger(null);
          return;
        }
      }
      onKeyDown?.(e);
    },
    [open, visibleItems, activeIdx, commit, onKeyDown]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const next = e.target.value;
      onChange(next);
      refreshTrigger(next, e.target.selectionEnd ?? next.length);
    },
    [onChange, refreshTrigger]
  );

  const handleSelect = useCallback(
    (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
      const ta = e.currentTarget;
      refreshTrigger(ta.value, ta.selectionEnd);
      onSelect?.(e);
    },
    [onSelect, refreshTrigger]
  );

  return (
    <Popover open={open}>
      <PopoverAnchor asChild>
        <Textarea
          {...props}
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onSelect={handleSelect}
          onBlur={(e) => {
            // Close menu when focus leaves the textarea unless focus moves
            // into the popover (item clicked).
            setTrigger(null);
            props.onBlur?.(e);
          }}
          className={className}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? 'mention-popover' : undefined}
        />
      </PopoverAnchor>
      <PopoverContent
        id="mention-popover"
        side="bottom"
        align="start"
        sideOffset={4}
        // Prevent Radix from stealing focus from the textarea on open.
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        // Stop pointerdown inside the popover from blurring the textarea.
        onMouseDown={(e) => e.preventDefault()}
        className="w-80 max-h-72 overflow-y-auto p-1"
      >
        <MentionList
          items={visibleItems}
          activeIdx={activeIdx}
          onHoverIndex={setActiveIdx}
          onSelect={commit}
        />
      </PopoverContent>
    </Popover>
  );
};

type MentionListProps = {
  items: MentionItem[];
  activeIdx: number;
  onHoverIndex: (idx: number) => void;
  onSelect: (item: MentionItem) => void;
};

const MentionList: React.FC<MentionListProps> = ({
  items,
  activeIdx,
  onHoverIndex,
  onSelect,
}) => {
  const sections = useMemo(() => {
    const out: Array<{ section: MentionSection; entries: MentionItem[] }> = [];
    for (const section of SECTION_ORDER) {
      const entries = items.filter((it) => it.section === section);
      if (entries.length > 0) out.push({ section, entries });
    }
    return out;
  }, [items]);

  let runningIdx = 0;
  return (
    <div aria-label="Mention suggestions" className="flex flex-col">
      {sections.map(({ section, entries }) => (
        <div key={section} className="py-1 first:pt-0 last:pb-0">
          <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {SECTION_LABELS[section]}
          </div>
          {entries.map((item) => {
            const idx = runningIdx++;
            const isActive = idx === activeIdx;
            return (
              <button
                key={item.id}
                type="button"
                aria-current={isActive ? 'true' : undefined}
                onMouseEnter={() => onHoverIndex(idx)}
                onClick={() => onSelect(item)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                  isActive
                    ? 'bg-accent text-accent-foreground'
                    : 'hover:bg-accent/50'
                )}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
                  {item.thumbnailUrl ? (
                    <img
                      src={item.thumbnailUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="text-[10px] text-muted-foreground">
                      {item.section === 'elements'
                        ? '◇'
                        : item.section === 'cast'
                          ? '☻'
                          : '⌖'}
                    </span>
                  )}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm">{item.label}</span>
                  {item.sublabel && (
                    <span className="truncate font-mono text-xs text-muted-foreground">
                      {item.sublabel}
                    </span>
                  )}
                </span>
                <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                  {item.tag}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
};
