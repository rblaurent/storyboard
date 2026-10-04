import { NotebookIcon } from '@phosphor-icons/react/dist/csr/Notebook'
import { ImageIcon } from '@phosphor-icons/react/dist/csr/Image'
import { CaretDownIcon } from '@phosphor-icons/react/dist/csr/CaretDown'
import { GoogleLogoIcon } from '@phosphor-icons/react/dist/csr/GoogleLogo'
import { ArrowUpRightIcon } from '@phosphor-icons/react/dist/csr/ArrowUpRight'
import { ArrowLeftIcon } from '@phosphor-icons/react/dist/csr/ArrowLeft'
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus'
import { SignOutIcon } from '@phosphor-icons/react/dist/csr/SignOut'
import { ArchiveIcon } from '@phosphor-icons/react/dist/csr/Archive'
import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowCounterClockwise'
import { TextAlignLeftIcon } from '@phosphor-icons/react/dist/csr/TextAlignLeft'
import { UsersThreeIcon } from '@phosphor-icons/react/dist/csr/UsersThree'
import { FloppyDiskIcon } from '@phosphor-icons/react/dist/csr/FloppyDisk'
import { SparkleIcon } from '@phosphor-icons/react/dist/csr/Sparkle'
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlass'
import { UserPlusIcon } from '@phosphor-icons/react/dist/csr/UserPlus'
import { UserMinusIcon } from '@phosphor-icons/react/dist/csr/UserMinus'
import { WarningCircleIcon } from '@phosphor-icons/react/dist/csr/WarningCircle'
import { CheckCircleIcon } from '@phosphor-icons/react/dist/csr/CheckCircle'
import { CircleNotchIcon } from '@phosphor-icons/react/dist/csr/CircleNotch'
import { MusicNotesIcon } from '@phosphor-icons/react/dist/csr/MusicNotes'
import { PlayIcon } from '@phosphor-icons/react/dist/csr/Play'
import { PauseIcon } from '@phosphor-icons/react/dist/csr/Pause'
import { SkipBackIcon } from '@phosphor-icons/react/dist/csr/SkipBack'
import { SkipForwardIcon } from '@phosphor-icons/react/dist/csr/SkipForward'
import { QueueIcon } from '@phosphor-icons/react/dist/csr/Queue'
import { ListBulletsIcon } from '@phosphor-icons/react/dist/csr/ListBullets'
import { PlaylistIcon } from '@phosphor-icons/react/dist/csr/Playlist'
import { SpotifyLogoIcon } from '@phosphor-icons/react/dist/csr/SpotifyLogo'
import { DotsSixVerticalIcon } from '@phosphor-icons/react/dist/csr/DotsSixVertical'
import { XIcon } from '@phosphor-icons/react/dist/csr/X'
import { ListIcon } from '@phosphor-icons/react/dist/csr/List'
import type { IconWeight } from '@phosphor-icons/react'

const icons = {
  notebook: NotebookIcon,
  image: ImageIcon,
  chevron: CaretDownIcon,
  google: GoogleLogoIcon,
  out: ArrowUpRightIcon,
  back: ArrowLeftIcon,
  plus: PlusIcon,
  signout: SignOutIcon,
  archive: ArchiveIcon,
  restore: ArrowCounterClockwiseIcon,
  description: TextAlignLeftIcon,
  players: UsersThreeIcon,
  save: FloppyDiskIcon,
  generate: SparkleIcon,
  search: MagnifyingGlassIcon,
  add: UserPlusIcon,
  remove: UserMinusIcon,
  warning: WarningCircleIcon,
  check: CheckCircleIcon,
  busy: CircleNotchIcon,
  music: MusicNotesIcon,
  play: PlayIcon,
  pause: PauseIcon,
  previous: SkipBackIcon,
  next: SkipForwardIcon,
  queue: QueueIcon,
  list: ListBulletsIcon,
  playlist: PlaylistIcon,
  spotify: SpotifyLogoIcon,
  drag: DotsSixVerticalIcon,
  close: XIcon,
  menu: ListIcon,
} as const

/** Presentation only: the surrounding text/control supplies its accessible name. */
export function SiteIcon({ name, size = 20, weight = 'regular', className = '' }: {
  name: keyof typeof icons; size?: 16 | 20 | 24 | 32; weight?: IconWeight; className?: string
}) {
  const Icon = icons[name]
  return <Icon size={size} weight={weight} color="currentColor" className={`site-icon ${className}`} aria-hidden="true" focusable="false" />
}
