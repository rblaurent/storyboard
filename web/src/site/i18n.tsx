import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import type { WorkspaceMessages } from '@redbamboo/workspace'
import { api } from './api'

export type Locale = 'en' | 'fr'

const french: Record<string, string> = {
  Language: 'Langue', Workspace: 'Espace de travail', 'The complete campaign database: worlds, characters, lore, jobs, and every custom record.': 'La base de données complète de la campagne : mondes, personnages, lore, tâches et chaque dossier personnalisé.', 'Opening the campaign workspace…': 'Ouverture de l’espace de travail de la campagne…', 'Try again': 'Réessayer',
  'About Storyboard': 'À propos de Storyboard', 'Sign out': 'Se déconnecter', 'Signing out…': 'Déconnexion…', 'Storyboard account': 'Compte Storyboard',
}

export const workspaceFrench: WorkspaceMessages = {
  pages: 'Pages', system: 'Système', searchResults: 'Résultats de recherche', recordsCouldNotLoad: 'Impossible de charger les dossiers.', loading: 'Chargement…', noSearchResults: 'Aucun dossier ne correspond à cette recherche.', noRecords: 'Aucun dossier ici.', loadMore: (loaded, total) => `Charger la suite · ${loaded} sur ${total}`,
  workspaceContents: 'Contenu de l’espace de travail', searchPlaceholder: 'Rechercher dans l’espace de travail', searchLabel: 'Rechercher dans l’espace de travail', newRecord: 'Nouveau', backToWorkspace: '← Espace de travail', saved: 'Enregistré.', recordCouldNotSave: 'Impossible d’enregistrer ce dossier.', deleteConfirm: name => `Supprimer « ${name} » ?`,
  recordCouldNotDelete: 'Impossible de supprimer ce dossier.', recordTitle: 'Titre du dossier', noEditableFields: 'Aucun champ modifiable', chooseRecord: 'Choisissez un dossier à gauche pour le consulter et le modifier.', typeHasNoFields: 'Ce type d’entité ne déclare aucun champ.', saving: 'Enregistrement…', saveChanges: 'Enregistrer', unsavedChanges: 'Modifications non enregistrées', allChangesSaved: 'Toutes les modifications sont enregistrées', delete: 'Supprimer',
  select: 'Sélectionner…', none: 'Aucun', newWorkspaceRecord: 'Nouveau dossier', close: 'Fermer', type: 'Type', name: 'Nom', location: 'Emplacement', cancel: 'Annuler', creating: 'Création…', create: 'Créer',
}

interface ContextValue { locale: Locale; setLocale: (locale: Locale) => void; syncAccount: (locale: Locale, csrfToken: string) => void; t: (english: string) => string }
const Context = createContext<ContextValue | null>(null)
function initial(): Locale { try { const value = localStorage.getItem('storyboard:locale'); if (value === 'en' || value === 'fr') return value } catch { /* optional */ } return navigator.languages.some(value => value.toLowerCase().startsWith('fr')) ? 'fr' : 'en' }

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setState] = useState<Locale>(initial), csrf = useRef(''), adopted = useRef(false)
  const setLocale = useCallback((next: Locale) => { setState(next); try { localStorage.setItem('storyboard:locale', next) } catch { /* optional */ } if (csrf.current) void api('/me/locale', csrf.current, 'PUT', { locale: next }).catch(() => {}) }, [])
  const syncAccount = useCallback((accountLocale: Locale, csrfToken: string) => { csrf.current = csrfToken; if (adopted.current) return; adopted.current = true; try { if (!localStorage.getItem('storyboard:locale')) setState(accountLocale) } catch { setState(accountLocale) } }, [])
  const value = useMemo<ContextValue>(() => ({ locale, setLocale, syncAccount, t: english => locale === 'fr' ? french[english] || english : english }), [locale, setLocale, syncAccount])
  return <Context.Provider value={value}>{children}</Context.Provider>
}
export function useLocale() { const value = useContext(Context); if (!value) throw new Error('useLocale must be inside LocaleProvider'); return value }
export function LanguageSwitch() { const { locale, setLocale, t } = useLocale(); return <div className="site-language-switch" role="group" aria-label={t('Language')}><button type="button" aria-pressed={locale === 'en'} onClick={() => setLocale('en')}>EN</button><button type="button" aria-pressed={locale === 'fr'} onClick={() => setLocale('fr')}>FR</button></div> }
