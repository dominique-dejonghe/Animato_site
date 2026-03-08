import type { FC } from 'hono/jsx'

interface AdminSidebarProps {
  activeSection?: string
  pendingRegistrationsCount?: number
}

export const AdminSidebar: FC<AdminSidebarProps> = ({ activeSection = 'dashboard', pendingRegistrationsCount = 0 }) => {
  const links = [
    { id: 'dashboard', label: 'Dashboard', href: '/admin', icon: 'fas fa-tachometer-alt' },
    { id: 'leden', label: 'Leden', href: '/admin/leden', icon: 'fas fa-users', badge: pendingRegistrationsCount > 0 ? pendingRegistrationsCount : undefined },
    { id: 'content', label: 'Nieuws & Berichten', href: '/admin/content', icon: 'fas fa-newspaper' },
    { id: 'events', label: 'Agenda, Events & Activiteiten', href: '/admin/events', icon: 'fas fa-calendar-alt' },
    { id: 'seating', label: 'Zaalplannen', href: '/admin/seating', icon: 'fas fa-chair' },
    { id: 'finance', label: 'Financiën & Lidgeld', href: '/admin/lidgelden', icon: 'fas fa-euro-sign' },
    { id: 'communications', label: 'Communicatie', href: '/admin/communicatie', icon: 'fas fa-envelope' },
    { id: 'meetings', label: 'Vergaderingen', href: '/admin/meetings', icon: 'fas fa-handshake' },
    { id: 'projects', label: 'Concert Projecten', href: '/admin/projects', icon: 'fas fa-project-diagram' },
    { id: 'prints', label: 'Afdrukken', href: '/admin/prints', icon: 'fas fa-print' },
    { id: 'materials', label: 'Materiaal', href: '/admin/bestanden', icon: 'fas fa-music' },
    { id: 'photos', label: 'Fotoboek', href: '/admin/fotoboek', icon: 'fas fa-images' },
    { id: 'modules', label: 'Module Beheer', href: '/admin/modules', icon: 'fas fa-toggle-on' },
    { id: 'feedback', label: 'Beta Feedback', href: '/admin/feedback', icon: 'fas fa-bug' },
    { id: 'walkthrough', label: 'Walkthrough Tours', href: '/admin/walkthrough', icon: 'fas fa-route' },
    { id: 'settings', label: 'Instellingen', href: '/admin/settings', icon: 'fas fa-cogs' },
  ]

  return (
    <aside class="w-64 bg-animato-secondary text-white hidden md:block flex-shrink-0 min-h-screen">
      <div class="p-6">
        <h2 class="text-2xl font-bold" style="font-family: 'Playfair Display', serif;">Admin</h2>
      </div>
      <nav class="mt-4 px-4 space-y-1">
        {links.map(link => {
          const isActive = activeSection === link.id
          return (
            <a
              href={link.href}
              class={`block py-2.5 px-4 rounded-lg transition-all flex items-center justify-between ${
                isActive
                  ? 'bg-white text-animato-secondary font-bold shadow-md'
                  : 'text-white hover:bg-white hover:bg-opacity-15'
              }`}
            >
              <div class="flex items-center">
                <i class={`${link.icon} w-6 mr-2.5 text-center ${isActive ? 'text-animato-secondary' : 'text-white text-opacity-80'}`}></i>
                <span class={isActive ? 'text-animato-secondary' : ''}>{link.label}</span>
              </div>
              {link.badge && (
                <span class="bg-blue-500 text-white text-xs font-bold px-2 py-0.5 rounded-full shadow-sm">
                  {link.badge}
                </span>
              )}
              {isActive && (
                <i class="fas fa-chevron-right text-xs text-animato-secondary ml-1"></i>
              )}
            </a>
          )
        })}
      </nav>
    </aside>
  )
}
