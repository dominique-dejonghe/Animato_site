// =====================================================
// BREADCRUMB — gedeelde breadcrumb-navigatie
// =====================================================
//
// Gebruik:
//   <Breadcrumb items={[
//     { label: 'Over ons', href: '/over' },
//     { label: 'Geschiedenis' }  // huidige pagina, geen href
//   ]} />
//
// Renders:  Home  >  Over ons  >  Geschiedenis
//
// Het eerste item ("Home", /) wordt automatisch toegevoegd.
// Het laatste item in `items` wordt als huidige pagina behandeld
// (geen link, andere kleur).

export interface BreadcrumbItem {
  label: string
  href?: string
}

export const Breadcrumb = ({ items }: { items: BreadcrumbItem[] }) => {
  // Altijd Home als eerste
  const allItems: BreadcrumbItem[] = [
    { label: 'Home', href: '/' },
    ...items,
  ]

  return (
    <nav aria-label="Breadcrumb" class="bg-animato-secondary border-b border-animato-primary/30 shadow-sm">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
        <ol class="flex flex-wrap items-center gap-1 text-sm">
          {allItems.map((item, idx) => {
            const isLast = idx === allItems.length - 1
            const isFirst = idx === 0
            return (
              <li class="flex items-center gap-1">
                {idx > 0 && (
                  <i class="fas fa-chevron-right text-white/40 text-xs mx-2" aria-hidden="true"></i>
                )}
                {isLast || !item.href ? (
                  <span
                    class={isLast ? 'text-white font-semibold' : 'text-white/80'}
                    aria-current={isLast ? 'page' : undefined}
                  >
                    {isFirst && <i class="fas fa-home mr-1.5" aria-hidden="true"></i>}
                    {item.label}
                  </span>
                ) : (
                  <a
                    href={item.href}
                    class="text-white/80 hover:text-white hover:underline transition-colors"
                  >
                    {isFirst && <i class="fas fa-home mr-1.5" aria-hidden="true"></i>}
                    {item.label}
                  </a>
                )}
              </li>
            )
          })}
        </ol>
      </div>
    </nav>
  )
}
