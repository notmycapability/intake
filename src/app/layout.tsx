import type { Metadata } from 'next'
import './globals.css'
import './v4.css'

export const metadata: Metadata = {
  title: 'Appsrow Discovery',
  description: 'Appsrow Discovery — questionnaire intelligence workspace.',
  icons: { icon: '/icon.svg' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
