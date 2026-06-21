import { GalleryIcon } from '@/components/icons/gallery-icon';
import { StyleDetailDialog } from '@/components/style/style-detail-dialog';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  groupStylesByCategory,
  styleCategoryLabel,
} from '@/lib/style/style-assets';
import { filterStyles } from '@/lib/utils/style-filters';
import type { Style } from '@/types/database';
import { Search, X } from 'lucide-react';
import type { ChangeEvent, FC } from 'react';
import { useCallback, useMemo, useState } from 'react';
import { StyleLibraryCard } from './style-library-card';

export type StyleSortMode = 'popular' | 'az';

type StyleLibraryViewProps = {
  styles: Style[] | undefined;
  category: string;
  sort: StyleSortMode;
  onCategoryChange: (category: string) => void;
  onSortChange: (sort: StyleSortMode) => void;
};

function sortStyles(styles: Style[], sort: StyleSortMode): Style[] {
  const sorted = [...styles];
  if (sort === 'az') {
    sorted.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    // Popular: most-used first, then the curated sortOrder, then name.
    sorted.sort(
      (a, b) =>
        (b.usageCount ?? 0) - (a.usageCount ?? 0) ||
        (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
        a.name.localeCompare(b.name)
    );
  }
  return sorted;
}

const CardGrid: FC<{ styles: Style[]; onSelect: (s: Style) => void }> = ({
  styles,
  onSelect,
}) => (
  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
    {styles.map((style) => (
      <StyleLibraryCard key={style.id} style={style} onSelect={onSelect} />
    ))}
  </div>
);

const GridSkeleton: FC = () => (
  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
    {Array.from({ length: 10 }, (_, i) => (
      <div key={i} className="flex flex-col gap-2">
        <Skeleton className="aspect-square rounded-lg" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    ))}
  </div>
);

/**
 * The browse experience for the top-level styles page: search + sort + category
 * filter chips over a category-grouped grid of style tiles. Selecting a tile
 * opens the read-only detail dialog. Category and sort are owned by the route
 * (URL-reflected); the search box is local.
 */
export const StyleLibraryView: FC<StyleLibraryViewProps> = ({
  styles,
  category,
  sort,
  onCategoryChange,
  onSortChange,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStyle, setSelectedStyle] = useState<Style | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const isLoading = styles === undefined;

  // Categories present in the catalogue, in canonical display order.
  const categories = useMemo(
    () =>
      isLoading
        ? []
        : ['all', ...groupStylesByCategory(styles).map((g) => g.category)],
    [styles, isLoading]
  );

  const filtered = useMemo(
    () => filterStyles(styles ?? [], category, searchQuery),
    [styles, category, searchQuery]
  );

  // When showing everything, bucket into category sections; otherwise a single
  // sorted grid for the chosen category.
  const groups = useMemo(() => {
    if (category === 'all') {
      return groupStylesByCategory(filtered).map((g) => ({
        ...g,
        styles: sortStyles(g.styles, sort),
      }));
    }
    return [
      {
        category,
        label: styleCategoryLabel(category),
        styles: sortStyles(filtered, sort),
      },
    ];
  }, [filtered, category, sort]);

  const handleSelect = useCallback((style: Style) => {
    setSelectedStyle(style);
    setDetailOpen(true);
  }, []);

  const handleSearchChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <InputGroup className="sm:max-w-xs">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              placeholder="Search styles"
              value={searchQuery}
              onChange={handleSearchChange}
              aria-label="Search styles"
            />
            {searchQuery && (
              <InputGroupAddon align="inline-end">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setSearchQuery('')}
                >
                  <X />
                  <span className="sr-only">Clear search</span>
                </Button>
              </InputGroupAddon>
            )}
          </InputGroup>

          <ToggleGroup
            type="single"
            value={sort}
            onValueChange={(value) => {
              if (value === 'popular' || value === 'az') onSortChange(value);
            }}
            variant="outline"
            className="sm:ml-auto"
          >
            <ToggleGroupItem value="popular">Popular</ToggleGroupItem>
            <ToggleGroupItem value="az">A–Z</ToggleGroupItem>
          </ToggleGroup>
        </div>

        {categories.length > 1 && (
          <ToggleGroup
            type="single"
            value={category}
            onValueChange={(value) => onCategoryChange(value || 'all')}
            className="flex flex-wrap justify-start"
          >
            {categories.map((cat) => (
              <ToggleGroupItem key={cat} value={cat} className="rounded-full">
                {cat === 'all' ? 'All' : styleCategoryLabel(cat)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
      </div>

      {isLoading ? (
        <GridSkeleton />
      ) : filtered.length === 0 ? (
        <Empty data-testid="styles-empty-state">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <GalleryIcon size="lg" />
            </EmptyMedia>
            <EmptyTitle>No styles found</EmptyTitle>
            <EmptyDescription>
              {searchQuery || category !== 'all'
                ? 'Try adjusting your search or filters.'
                : 'There are no styles available yet.'}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-8">
          {groups.map((group) => (
            <section key={group.category} className="flex flex-col gap-3">
              <div className="flex items-baseline gap-2">
                <h2 className="text-lg font-semibold tracking-tight">
                  {group.label}
                </h2>
                <span className="text-sm text-muted-foreground">
                  {group.styles.length}
                </span>
              </div>
              <CardGrid styles={group.styles} onSelect={handleSelect} />
            </section>
          ))}
        </div>
      )}

      <StyleDetailDialog
        style={selectedStyle}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </div>
  );
};
