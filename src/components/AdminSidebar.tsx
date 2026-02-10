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
    { id: 'events', label: 'Agenda & Concerten', href: '/admin/events', icon: 'fas fa-calendar-alt' },
    { id: 'activities', label: 'Activiteiten & Feest', href: '/admin/activities', icon: 'fas fa-glass-cheers' },
    { id: 'projects', label: 'Projecten', href: '/admin/projects', icon: 'fas fa-tasks' },
    { id: 'prints', label: 'Printservice', href: '/admin/prints', icon: 'fas fa-print' },
    { id: 'finance', label: 'Lidgelden', href: '/admin/lidgelden', icon: 'fas fa-euro-sign' },
    { id: 'meetings', label: 'Vergaderingen', href: '/admin/meetings', icon: 'fas fa-handshake' },
    { id: 'materials', label: 'Materiaal', href: '/admin/bestanden', icon: 'fas fa-music' },
    { id: 'photos', label: 'Fotoboek', href: '/admin/fotoboek', icon: 'fas fa-images' },
    { id: 'settings', label: 'Instellingen', href: '/admin/settings', icon: 'fas fa-cogs' },
  ]

  return (
    <aside class="w-64 bg-animato-secondary text-white hidden md:block flex-shrink-0 min-h-screen">
      <div class="p-6">
        <h2 class="text-2xl font-bold" style="font-family: 'Playfair Display', serif;">Admin</h2>
      </div>
      <nav class="mt-4 px-4 space-y-2">
        {links.map(link => (
          <a 
            href={link.href} 
            class={`block py-2 px-4 rounded transition-colors flex items-center justify-between ${
              activeSection === link.id 
                ? 'bg-white bg-opacity-20 font-semibold' 
                : 'hover:bg-white hover:bg-opacity-10'
            }`}
          >
            <div class="flex items-center">
              <i class={`${link.icon} w-6 mr-2 text-center`}></i>
              {link.label}
            </div>
            {link.badge && (
              <span class="bg-blue-500 text-white text-xs font-bold px-2 py-0.5 rounded-full shadow-sm">
                {link.badge}
              </span>
            )}
          </a>
        ))}
      </nav>
    </aside>
  )
}
