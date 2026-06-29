import { api } from './api'

export type SignupPayload = {
  owner_name: string
  email: string
  organization: string
  industry: string
  location: string
  employee_count: string
}

export type SignupResponse = {
  message: string
  workspace_id: string
}

export type LoginPayload = {
  email: string
  password: string
}

export type LoginResponse = {
  token: string
  must_change_password: boolean
  role: string
  name: string
}

export type ChangePasswordPayload = {
  new_password: string
}

export type MessageResponse = {
  message: string
}

export type ResetPasswordPayload = {
  reset_token: string
  new_password: string
}

export const FORGOT_PASSWORD_MESSAGE = 'If an account exists with this email, a reset link has been sent.'

export function signup(payload: SignupPayload) {
  return api.post('/api/auth/signup', payload) as Promise<SignupResponse>
}

export function login(payload: LoginPayload) {
  return api.post('/api/auth/login', payload) as Promise<LoginResponse>
}

export function changePassword(payload: ChangePasswordPayload) {
  return api.post('/api/auth/change-password', payload) as Promise<MessageResponse>
}

export function forgotPassword(payload: { email: string }) {
  return api.post('/api/auth/forgot-password', payload) as Promise<MessageResponse>
}

export function resetPassword(payload: ResetPasswordPayload) {
  return api.post('/api/auth/reset-password', payload) as Promise<MessageResponse>
}

export function setAuthToken(token: string) {
  localStorage.setItem('token', token)
}

export function clearAuthToken() {
  localStorage.removeItem('token')
  localStorage.removeItem('auth_user_name')
  localStorage.removeItem('auth_role')
  localStorage.removeItem('auth_email')
  sessionStorage.removeItem('must_change_password')
  sessionStorage.removeItem('auth_user_name')
  sessionStorage.removeItem('auth_role')
  sessionStorage.removeItem('auth_email')
}

export function logout() {
  clearAuthToken()
}

export function setMustChangePassword(required: boolean) {
  if (required) {
    sessionStorage.setItem('must_change_password', '1')
  } else {
    sessionStorage.removeItem('must_change_password')
  }
}

export function setAuthUserName(name: string) {
  sessionStorage.setItem('auth_user_name', name)
  localStorage.setItem('auth_user_name', name)
}

export function getAuthUserName() {
  return sessionStorage.getItem('auth_user_name')
    || localStorage.getItem('auth_user_name')
    || ''
}

export function setAuthRole(role: string) {
  sessionStorage.setItem('auth_role', role)
  localStorage.setItem('auth_role', role)
}

export function getAuthRole() {
  return sessionStorage.getItem('auth_role')
    || localStorage.getItem('auth_role')
    || ''
}

export function setAuthEmail(email: string) {
  const normalized = email.trim()
  if (!normalized) return
  sessionStorage.setItem('auth_email', normalized)
  localStorage.setItem('auth_email', normalized)
}

export function getAuthEmail() {
  return sessionStorage.getItem('auth_email')
    || localStorage.getItem('auth_email')
    || ''
}

function parseJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const segment = token.split('.')[1]
    if (!segment) return null
    const json = atob(segment.replace(/-/g, '+').replace(/_/g, '/'))
    const payload = JSON.parse(json)
    return typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : null
  } catch {
    return null
  }
}

function readTokenStringClaim(payload: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = payload[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

export function getRoleFromToken(token: string) {
  const payload = parseJwtPayload(token)
  if (!payload) return ''
  return readTokenStringClaim(payload, 'role', 'user_role', 'workspace_role')
}

export function getEmailFromToken(token: string) {
  const payload = parseJwtPayload(token)
  if (!payload) return ''
  const email = readTokenStringClaim(payload, 'email', 'user_email')
  if (email.includes('@')) return email
  const sub = readTokenStringClaim(payload, 'sub')
  return sub.includes('@') ? sub : ''
}

export function isAdminRole(role: string) {
  const normalized = role.trim().toLowerCase().replace(/[\s-]+/g, '_')
  return normalized === 'admin'
    || normalized === 'owner'
    || normalized === 'workspace_admin'
    || normalized === 'workspace_owner'
}

export function normalizeAuthRole(role: string) {
  return isAdminRole(role) ? 'admin' : 'employee'
}

export function resolveAuthRole() {
  const stored = getAuthRole().trim()
  if (stored) return normalizeAuthRole(stored)

  const token = getAuthToken()
  if (!token) return ''

  const fromToken = getRoleFromToken(token)
  if (fromToken) {
    const normalized = normalizeAuthRole(fromToken)
    setAuthRole(normalized)
    return normalized
  }

  return ''
}

export function syncAuthRoleFromTeam(members: { email: string; role: string }[]) {
  const email = (getAuthEmail() || getEmailFromToken(getAuthToken() || '')).trim().toLowerCase()
  if (!email) return null

  const member = members.find((item) => item.email.trim().toLowerCase() === email)
  if (!member) return null

  const role = normalizeAuthRole(member.role)
  setAuthRole(role)
  if (!getAuthEmail()) setAuthEmail(member.email)
  return role
}

export function mustChangePasswordPending() {
  return sessionStorage.getItem('must_change_password') === '1' && !!localStorage.getItem('token')
}

export function getResetTokenFromUrl() {
  return new URLSearchParams(window.location.search).get('token')
}

export function getAuthToken() {
  return localStorage.getItem('token')
}

export function isAuthenticated() {
  return !!getAuthToken()
}

export function getInitialAuthScreen() {
  const path = window.location.pathname.replace(/\/$/, '') || '/'

  if (path === '/reset-password') return 'reset-password'

  const token = getAuthToken()
  if (!token) return 'signin'

  if (mustChangePasswordPending()) return 'signin'

  if (path === '/billing') return 'workspace'

  return 'dashboard'
}

export function getInitialSignInMode(): 'login' | 'reset-password' {
  return mustChangePasswordPending() ? 'reset-password' : 'login'
}

export function getInitialWorkspaceTab(): 'billing' | 'connect' | 'scoring' | 'team' {
  const path = window.location.pathname.replace(/\/$/, '')
  return path === '/billing' ? 'billing' : 'billing'
}

export function goToAppRoot() {
  window.history.replaceState({}, '', '/')
}

export function goToBillingPath() {
  window.history.replaceState({}, '', '/billing')
}
