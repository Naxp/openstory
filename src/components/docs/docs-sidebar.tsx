import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { SECTION_ORDER } from '@/lib/docs/sections';
import { Link, useRouterState } from '@tanstack/react-router';
import { allDocs } from 'content-collections';

function buildNavTree() {
  const grouped = new Map<string, typeof allDocs>();

  for (const doc of allDocs) {
    const existing = grouped.get(doc.section);
    if (existing) {
      existing.push(doc);
    } else {
      grouped.set(doc.section, [doc]);
    }
  }

  for (const items of grouped.values()) {
    items.sort((a, b) => a.order - b.order);
  }

  return SECTION_ORDER.reduce<{ section: string; items: typeof allDocs }[]>(
    (acc, section) => {
      const items = grouped.get(section);
      if (items) {
        acc.push({ section, items });
      }
      return acc;
    },
    []
  );
}

const navTree = buildNavTree();

export const DocsSidebar: React.FC = () => {
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;

  return (
    <>
      {navTree.map(({ section, items }) => (
        <SidebarGroup key={section}>
          <SidebarGroupLabel>{section}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((doc) => {
                const href = `/docs/${doc.slug}`;
                const isActive =
                  currentPath === href || currentPath === `${href}/`;

                return (
                  <SidebarMenuItem key={doc.slug}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={doc.title}
                    >
                      <Link to={href}>
                        <span>{doc.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  );
};
