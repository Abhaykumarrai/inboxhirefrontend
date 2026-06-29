import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  signup, login, changePassword, forgotPassword, resetPassword, FORGOT_PASSWORD_MESSAGE,
  setAuthToken, setAuthUserName as persistAuthUserName, setAuthRole as persistAuthRole,
  setAuthEmail as persistAuthEmail, setMustChangePassword, logout, isAdminRole,
  getAuthRole, resolveAuthRole, syncAuthRoleFromTeam, getAuthToken, normalizeAuthRole,
  getInitialAuthScreen, getInitialSignInMode, getInitialWorkspaceTab, getAuthUserName,
  getResetTokenFromUrl, goToAppRoot, goToBillingPath,
} from './lib/auth'
import {
  getBillingCurrent, getBillingPlans, billingCurrentToUsage,
  filterPurchasablePlans, planToUpgradeOption,
  createBillingOrder, verifyBillingPayment, PAYMENT_VERIFY_FAILED_MESSAGE,
} from './lib/billing'
import { openRazorpayCheckout } from './lib/razorpay'
import {
  fetchGmailConnectionsForUi, assignGmailConnection, disconnectGmailConnection,
  openGmailConnectPopup, pollForNewGmailConnection,
} from './lib/gmail'
import { fetchTeamMembersForUi, syncTeamInboxAssignments } from './lib/team'
import { agentChat, confirmDraft, cancelDraft } from './lib/agent'
import {
  searchCandidates,
  mapSearchCandidateToUi,
  getSearchCandidateMatchingSkills,
  enrichSearchCandidateContact,
} from './lib/search'
import { speak } from './lib/voice'
import {
  fetchDriveConnection, getDriveFolders, setDriveFolder, disconnectDriveConnection,
  openDriveConnectPopup, pollForDriveConnection, driveHasFolder, getDriveAccountEmail,
} from './lib/drive'
import {
  fetchJobs, fetchJobsList, createJob, scanJob, pauseJob, resumeJob,
  closeJob, reopenJob, deleteJob, updateJob,
  fetchJobCandidates, resolveJobUsage,
} from './lib/jobs'
import { fetchAvailableSources } from './lib/sources'
import { updateApplicationStage, sendApplicationEmail, saveApplicationNote, uiStageToApi } from './lib/applications'
import { parseSkillsInput, formatSkillsInput, parseOptionalInt, validateJobFormFields } from './lib/jobForm'
import { ApiError } from './lib/api'
import {
  fetchScoringWeights, saveScoringWeights, resetScoringWeights,
  SCORING_WEIGHT_FIELDS, SCORING_WEIGHT_LABELS,
  getScoringWeightsTotal, isValidScoringWeights,
} from './lib/settings'
import ResumePdfModal from './components/ResumePdfModal'

const EMPTY_JOB_FORM = {
  title: '',
  expMin: '',
  expMax: '',
  education: '',
  location: '',
  primarySkillsText: '',
  secondarySkillsText: '',
}

const EZ_APP_ICON = 'chart-line'

let pageScrollLockCount = 0

function lockPageScroll() {
  pageScrollLockCount += 1
  if (pageScrollLockCount !== 1) return
  document.documentElement.classList.add('ez-scroll-lock')
}

function unlockPageScroll() {
  if (pageScrollLockCount === 0) return
  pageScrollLockCount -= 1
  if (pageScrollLockCount !== 0) return
  document.documentElement.classList.remove('ez-scroll-lock')
}

const SCAN_RANGES = [
  { days: 7, label: 'Last 7 days', hint: 'Quick scan' },
  { days: 30, label: 'Last 30 days', hint: 'Recommended', recommended: true },
  { days: 90, label: 'Last 90 days', hint: 'Deep scan' },
]

function ScanInboxModal({ open, jobTitle, scanDays, onScanDaysChange, onClose, onStart }) {
  if (!open) return null

  const title = jobTitle.trim() || 'this role'

  return (
    <div className="scan-modal-overlay fixed inset-0 z-50 flex items-center justify-center p-6" role="dialog" aria-modal="true" aria-labelledby="scan-modal-title">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close" onClick={onClose} />
      <div className="scan-modal relative w-full max-w-lg rounded-3xl p-8">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="setup-icon-wrap w-14 h-14 rounded-2xl flex items-center justify-center mb-4">
            <FaIcon icon="envelope-open-text" size={26} />
          </div>
          <h2 id="scan-modal-title" className="type-section theme-heading">Ready to scan your inbox</h2>
          <p className="type-body theme-muted mt-2">
            Scanning for <span className="font-semibold theme-heading">{title}</span> applications.
          </p>
        </div>

        <p className="type-label theme-muted mb-3">How far back should we scan?</p>
        <div className="space-y-2.5 mb-5">
          {SCAN_RANGES.map(({ days, label, hint, recommended }) => {
            const selected = scanDays === days
            return (
              <button
                key={days}
                type="button"
                onClick={() => onScanDaysChange(days)}
                className={`scan-option w-full rounded-xl px-4 py-3.5 flex items-center justify-between gap-3 text-left transition-colors ${selected ? 'scan-option-selected' : ''}`}
              >
                <div className="flex items-center gap-3">
                  <span className={`scan-option-radio flex-shrink-0 ${selected ? 'scan-option-radio-selected' : ''}`} />
                  <span className="type-subheading theme-heading">{label}</span>
                </div>
                <span className={`type-caption flex-shrink-0 ${recommended ? 'text-[#2d6a84] font-semibold' : 'theme-muted'}`}>
                  {hint}
                </span>
              </button>
            )
          })}
        </div>

        <div className="scan-modal-info rounded-xl px-4 py-3.5 flex gap-3 mb-8">
          <FaIcon icon="circle-info" size={18} className="text-ez-accent flex-shrink-0 mt-0.5" />
          <p className="type-caption theme-muted text-left leading-relaxed">
            Our AI parser will automatically extract CVs from your inbox. This process typically takes 5–15 minutes depending on volume.
          </p>
        </div>

        <div className="flex items-center justify-between gap-4">
          <button type="button" onClick={onClose} className="type-button theme-muted hover:text-ez-accent px-2">
            Back
          </button>
          <button
            type="button"
            onClick={onStart}
            className="type-button bg-[#2d6a84] hover:bg-[#235470] text-white rounded-xl py-3 px-8 transition-colors"
          >
            Start Scanning
          </button>
        </div>
      </div>
    </div>
  )
}

function GmailBrandIcon({ size = 28 }) {
  return (
    <svg className="scan-source-brand-icon" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#4caf50" d="M45,16.086l-5-3.094l-5,3.073V9H5v30h38V16.086z" />
      <path fill="#1e88e5" d="M40,16.086V9H24v7.086L35,22L40,16.086z" />
      <path fill="#e53935" d="M13,16.086L24,22l11-5.914V9H13V16.086z" />
      <path fill="#c62828" d="M24,22L5,9v30h38V9L24,22z" opacity="0.12" />
      <path fill="#fbc02d" d="M13,9v7.086L24,22V9H13z" />
    </svg>
  )
}

function DriveBrandIcon({ size = 28 }) {
  return (
    <svg className="scan-source-brand-icon" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M16.64 36H6.36L24 8.8 41.64 36H31.36L24 23.2 16.64 36z" />
      <path fill="#1976D2" d="M6.36 36L24 8.8 11.52 36H6.36z" />
      <path fill="#4CAF50" d="M41.64 36L24 8.8 36.48 36h5.16z" />
    </svg>
  )
}

function JobScanSourceCard({
  tone,
  title,
  description,
  status,
  connected,
  badge,
  brand,
  onClick,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`scan-source-card scan-source-card-${tone} job-scan-source-card`}
    >
      <span className="scan-source-card-glow" aria-hidden="true" />
      <span className="scan-source-card-accent" aria-hidden="true" />

      <div className="scan-source-card-head">
        <div className={`scan-source-card-icon scan-source-card-icon-${tone}${brand === 'gmail' ? ' scan-source-card-icon-gmail' : ''}`}>
          {brand === 'gmail' ? <GmailBrandIcon size={30} /> : <DriveBrandIcon size={30} />}
        </div>
        {badge && <span className="scan-source-card-badge">{badge}</span>}
      </div>

      <div className="scan-source-card-body">
        <h3 className="scan-source-card-title">{title}</h3>
        <p className="scan-source-card-desc">{description}</p>
        <div className="scan-source-card-tags">
          <span className={`scan-source-card-tag scan-source-card-tag-${connected ? 'live' : 'muted'}`}>
            <span className={`scan-source-card-status-dot ${connected ? 'is-connected' : ''}`} aria-hidden="true" />
            {status}
          </span>
        </div>
      </div>

      <div className="scan-source-card-foot">
        <span className="scan-source-card-cta">
          Use this source
          <FaIcon icon="arrow-right" size={12} />
        </span>
      </div>
    </button>
  )
}

function JobSetupOptionCard({ tone, title, description, icon, badge, tag, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`scan-source-card scan-source-card-${tone} job-setup-option-card`}
    >
      <span className="scan-source-card-glow" aria-hidden="true" />
      <span className="scan-source-card-accent" aria-hidden="true" />

      <div className="scan-source-card-head">
        <div className={`scan-source-card-icon scan-source-card-icon-${tone}`}>
          <FaIcon icon={icon} size={24} />
        </div>
        {badge && <span className="scan-source-card-badge">{badge}</span>}
      </div>

      <div className="scan-source-card-body">
        <h3 className="scan-source-card-title">{title}</h3>
        <p className="scan-source-card-desc">{description}</p>
        {tag && (
          <div className="scan-source-card-tags">
            <span className="scan-source-card-tag">{tag}</span>
          </div>
        )}
      </div>

      <div className="scan-source-card-foot">
        <span className="scan-source-card-cta">
          Get started
          <FaIcon icon="arrow-right" size={12} />
        </span>
      </div>
    </button>
  )
}

function JobSetupOptions({ onSelectPaste, onSelectUpload, onSelectManual, onChangeSource }) {
  return (
    <div className="job-setup-options">
      <button type="button" onClick={onChangeSource} className="job-setup-back">
        ← Change source
      </button>
      <span className="modern-eyebrow">Job setup</span>
      <h1 className="type-section theme-heading mt-1">Set up your job</h1>
      <p className="type-body theme-muted mt-2 mb-8 max-w-2xl">
        Paste a JD, upload a file, or create the role manually — we&apos;ll extract requirements and pre-fill the form.
      </p>
      <div className="job-setup-options-grid">
        <JobSetupOptionCard
          tone="lavender"
          icon="paste"
          title="Paste JD"
          description="Copy and paste text from any job post or careers page."
          badge="Recommended"
          onClick={onSelectPaste}
        />
        <JobSetupOptionCard
          tone="drive"
          icon="file-arrow-up"
          title="Upload JD"
          description="Import a job description file from your computer."
          tag="PDF · DOC · TXT"
          onClick={onSelectUpload}
        />
        <JobSetupOptionCard
          tone="api"
          icon="pen-to-square"
          title="Create manually"
          description="Skip parsing and fill in job details yourself."
          onClick={onSelectManual}
        />
      </div>
    </div>
  )
}

function SourcePicker({ ready, gmailOptions, driveSource, onSelectGmail, onSelectDrive }) {
  const gmailConnected = gmailOptions.length > 0
  const driveConnected = Boolean(driveSource)
  const gmailStatus = gmailConnected
    ? `${gmailOptions.length} inbox${gmailOptions.length === 1 ? '' : 'es'} connected`
    : 'No inbox connected yet'
  const driveStatus = driveSource?.folder_name
    ? `Folder · ${driveSource.folder_name}`
    : driveSource
      ? 'Connected — pick a folder next'
      : 'Not connected yet'

  return (
    <div className="job-source-picker">
      <span className="modern-eyebrow">Import CVs</span>
      <h1 className="type-section theme-heading mt-1">Choose scan source</h1>
      <p className="type-body theme-muted mt-2 mb-8 max-w-xl">
        Pick where InboxHire should import CVs from for this job. We&apos;ll scan, parse, and rank candidates automatically.
      </p>
      {!ready ? (
        <SourcePickerSkeleton />
      ) : (
        <div className="job-source-picker-grid">
          <JobScanSourceCard
            tone="lavender"
            brand="gmail"
            title="Gmail inbox"
            description="Pull CVs from application emails and attachments in your connected inbox."
            status={gmailStatus}
            connected={gmailConnected}
            badge="Popular"
            onClick={onSelectGmail}
          />
          <JobScanSourceCard
            tone="drive"
            brand="drive"
            title="Google Drive"
            description="Import resumes from a synced Drive folder — ideal for shared hiring folders."
            status={driveStatus}
            connected={driveConnected}
            onClick={onSelectDrive}
          />
        </div>
      )}
    </div>
  )
}

function GmailSourcePickerModal({ open, options, onSelect, onClose }) {
  if (!open) return null
  return (
    <div className="connect-modal-overlay" role="dialog" aria-modal="true">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close" onClick={onClose} />
      <div className="connect-modal relative">
        <div className="connect-modal-header">
          <div className="min-w-0">
            <h2 className="connect-modal-title theme-heading">Choose Gmail inbox</h2>
            <p className="connect-modal-subtitle type-caption theme-muted">Select which inbox to scan for this job</p>
          </div>
          <button type="button" className="connect-modal-close" onClick={onClose} aria-label="Close">
            <FaIcon icon="xmark" size={14} />
          </button>
        </div>
        <div className="connect-modal-body">
          <div className="drive-folder-list">
            {options.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => onSelect(option.id)}
                className="drive-folder-option"
              >
                <span className="drive-folder-option-icon" aria-hidden="true">
                  <FaIcon icon="envelope" size={16} />
                </span>
                <span className="drive-folder-option-copy min-w-0">
                  <span className="drive-folder-option-name theme-heading">{option.gmail_email}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function ScanDateRangeField({ from, to, onChange, error, compact = false }) {
  const inputClass = compact
    ? 'job-form-input theme-input type-input border w-full focus:outline-none focus:ring-2 focus:ring-[var(--ez-accent)] focus:border-transparent'
    : 'theme-input type-input border rounded-xl px-4 py-3 w-full focus:outline-none focus:ring-2 focus:ring-[#2d6a84] focus:border-transparent'

  if (compact) {
    return (
      <div className="job-form-field job-form-field-span-2">
        <span className="job-form-label">Scan date range</span>
        <div className="job-form-date-row">
          <input
            type="date"
            value={from}
            onChange={(e) => onChange(e.target.value, to)}
            className={inputClass}
            aria-label="Scan from date"
          />
          <input
            type="date"
            value={to}
            onChange={(e) => onChange(from, e.target.value)}
            className={inputClass}
            aria-label="Scan to date"
          />
        </div>
        {!error && (
          <p className="job-form-hint">Leave blank to scan yesterday only.</p>
        )}
        {error && <p className="job-form-error">{error}</p>}
      </div>
    )
  }

  return (
    <div className="mb-6">
      <label className="type-label theme-muted mb-1.5 block">Scan date range</label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <input
          type="date"
          value={from}
          onChange={(e) => onChange(e.target.value, to)}
          className={inputClass}
        />
        <input
          type="date"
          value={to}
          onChange={(e) => onChange(from, e.target.value)}
          className={inputClass}
        />
      </div>
      <p className="type-caption theme-muted mt-2">Defaults to yesterday only if left unset.</p>
      {error && <p className="type-caption text-[#e8824a] mt-1">{error}</p>}
    </div>
  )
}

function JobFormField({ label, hint, error, span = 1, children }) {
  return (
    <div className={`job-form-field${span === 2 ? ' job-form-field-span-2' : ''}`}>
      <label className="job-form-label">{label}</label>
      {children}
      {hint && !error && <p className="job-form-hint">{hint}</p>}
      {error && <p className="job-form-error">{error}</p>}
    </div>
  )
}

const JOB_FORM_STEPS = [
  {
    id: 'role',
    label: 'Role',
    title: 'Define the role',
    subtitle: 'Job title and experience range for this opening.',
  },
  {
    id: 'profile',
    label: 'Profile',
    title: 'Candidate profile',
    subtitle: 'Education and location preferences.',
  },
  {
    id: 'skills',
    label: 'Skills',
    title: 'Required skills',
    subtitle: 'Must-haves and nice-to-haves for matching.',
  },
  {
    id: 'scan',
    label: 'Scan',
    title: 'Scan window',
    subtitle: 'When to pull CVs from your connected source.',
  },
]

function JobFormStepper({ steps, currentStep }) {
  return (
    <nav className="job-form-stepper" aria-label="Job form progress">
      <ol className="job-form-stepper-list">
        {steps.map((item, index) => {
          const isComplete = index < currentStep
          const isActive = index === currentStep
          return (
            <li
              key={item.id}
              className={`job-form-stepper-item${isActive ? ' is-active' : ''}${isComplete ? ' is-complete' : ''}`}
              aria-current={isActive ? 'step' : undefined}
            >
              <span className="job-form-stepper-marker" aria-hidden="true">
                {isComplete ? <FaIcon icon="check" size={10} /> : index + 1}
              </span>
              <span className="job-form-stepper-label">{item.label}</span>
              {index < steps.length - 1 && <span className="job-form-stepper-line" aria-hidden="true" />}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

function CreateJobDetailsForm({
  extractedFields,
  onFieldsChange,
  scanFromDate,
  scanToDate,
  onScanDatesChange,
  jobFormErrors,
  jobFormReady,
  jobSubmitting,
  aiPrefilled,
  onChangeSource,
  onBack,
  onSubmit,
}) {
  const [step, setStep] = useState(0)
  const inputClass = 'job-form-input theme-input type-input border w-full focus:outline-none focus:ring-2 focus:ring-[var(--ez-accent)] focus:border-transparent'
  const currentStepMeta = JOB_FORM_STEPS[step]
  const isLastStep = step === JOB_FORM_STEPS.length - 1
  const canContinue = step === 0 ? extractedFields.title.trim().length > 0 : true

  const handleBack = () => {
    if (step === 0) {
      onBack()
      return
    }
    setStep((current) => current - 1)
  }

  const handleContinue = () => {
    if (!canContinue || jobSubmitting) return
    if (isLastStep) {
      onSubmit()
      return
    }
    setStep((current) => current + 1)
  }

  useEffect(() => {
    if (jobFormErrors.experience) setStep(0)
    else if (jobFormErrors.scanDates) setStep(3)
  }, [jobFormErrors.experience, jobFormErrors.scanDates])

  return (
    <div className="job-form-wizard">
      <header className="job-form-wizard-header">
        <button type="button" onClick={onChangeSource} className="job-form-back">
          ← Change source
        </button>
        <div className="job-form-header-main">
          <div>
            <span className="modern-eyebrow">New job</span>
            <h2 className="job-form-title theme-heading">Job details</h2>
          </div>
          {aiPrefilled && <span className="job-form-ai-badge">AI pre-filled</span>}
        </div>
      </header>

      <JobFormStepper steps={JOB_FORM_STEPS} currentStep={step} />

      <section className="job-form-step-content" aria-labelledby="job-form-step-title">
        <h3 id="job-form-step-title" className="job-form-step-title theme-heading">
          {currentStepMeta.title}
        </h3>
        <p className="job-form-step-subtitle type-body theme-muted">{currentStepMeta.subtitle}</p>

        <div className="job-form-grid">
          {step === 0 && (
            <>
              <JobFormField label="Job title" span={2}>
                <input
                  type="text"
                  value={extractedFields.title}
                  onChange={(e) => onFieldsChange({ ...extractedFields, title: e.target.value })}
                  placeholder="e.g. Senior React Developer"
                  className={inputClass}
                  autoFocus
                />
              </JobFormField>
              <JobFormField label="Min experience (years)">
                <input
                  type="number"
                  min="0"
                  value={extractedFields.expMin}
                  onChange={(e) => onFieldsChange({ ...extractedFields, expMin: e.target.value })}
                  placeholder="4"
                  className={inputClass}
                />
              </JobFormField>
              <JobFormField label="Max experience (years)" error={jobFormErrors.experience}>
                <input
                  type="number"
                  min="0"
                  value={extractedFields.expMax}
                  onChange={(e) => onFieldsChange({ ...extractedFields, expMax: e.target.value })}
                  placeholder="6"
                  className={inputClass}
                />
              </JobFormField>
            </>
          )}

          {step === 1 && (
            <>
              <JobFormField label="Education">
                <input
                  type="text"
                  value={extractedFields.education}
                  onChange={(e) => onFieldsChange({ ...extractedFields, education: e.target.value })}
                  placeholder="e.g. B.Tech CS"
                  className={inputClass}
                  autoFocus
                />
              </JobFormField>
              <JobFormField label="Current location">
                <input
                  type="text"
                  value={extractedFields.location}
                  onChange={(e) => onFieldsChange({ ...extractedFields, location: e.target.value })}
                  placeholder="e.g. Bangalore"
                  className={inputClass}
                />
              </JobFormField>
            </>
          )}

          {step === 2 && (
            <>
              <JobFormField label="Primary skills" hint="Comma-separated">
                <input
                  type="text"
                  value={extractedFields.primarySkillsText}
                  onChange={(e) => onFieldsChange({ ...extractedFields, primarySkillsText: e.target.value })}
                  placeholder="React, TypeScript, Node.js"
                  className={inputClass}
                  autoFocus
                />
              </JobFormField>
              <JobFormField label="Secondary skills" hint="Optional, comma-separated">
                <input
                  type="text"
                  value={extractedFields.secondarySkillsText}
                  onChange={(e) => onFieldsChange({ ...extractedFields, secondarySkillsText: e.target.value })}
                  placeholder="PostgreSQL, AWS"
                  className={inputClass}
                />
              </JobFormField>
            </>
          )}

          {step === 3 && (
            <ScanDateRangeField
              compact
              from={scanFromDate}
              to={scanToDate}
              onChange={onScanDatesChange}
              error={jobFormErrors.scanDates}
            />
          )}
        </div>
      </section>

      <footer className="job-form-wizard-actions">
        <button
          type="button"
          onClick={handleBack}
          className="dashboard-outline-btn type-button job-form-btn job-form-btn-secondary"
          disabled={jobSubmitting}
        >
          {step === 0 ? 'Back' : 'Previous'}
        </button>
        <button
          type="button"
          disabled={!canContinue || (isLastStep && (!jobFormReady || jobSubmitting))}
          onClick={handleContinue}
          className={`job-form-btn job-form-btn-primary type-button ${canContinue && (!isLastStep || (jobFormReady && !jobSubmitting)) ? '' : 'is-disabled'}`}
        >
          {jobSubmitting
            ? 'Creating & scanning…'
            : isLastStep
              ? 'Review & scan'
              : 'Continue'}
        </button>
      </footer>
    </div>
  )
}

const SCAN_SOURCE_OPTIONS = [
  {
    id: 'gmail',
    title: 'Gmail',
    icon: 'envelope',
    brand: false,
    tone: 'lavender',
    badge: 'Popular',
  },
  {
    id: 'drive',
    title: 'Google Drive',
    icon: 'google-drive',
    brand: true,
    tone: 'drive',
  },
  {
    id: 'api',
    title: 'API connect',
    icon: 'plug',
    brand: false,
    tone: 'api',
  },
]

const PAYMENT_CONFETTI_COLORS = [
  '#928DDD',
  '#B2AEF2',
  '#CAC8F9',
  '#E7E9EF',
  '#928DDD',
  '#B2AEF2',
]

function createPaymentConfetti(count = 52) {
  return Array.from({ length: count }, (_, index) => ({
    id: index,
    left: `${4 + Math.random() * 92}%`,
    delay: `${Math.random() * 0.65}s`,
    duration: `${2.4 + Math.random() * 1.4}s`,
    drift: `${-60 + Math.random() * 120}px`,
    spin: `${180 + Math.random() * 540}deg`,
    color: PAYMENT_CONFETTI_COLORS[index % PAYMENT_CONFETTI_COLORS.length],
    size: `${5 + Math.random() * 7}px`,
    shape: index % 3 === 0 ? 'circle' : index % 3 === 1 ? 'rect' : 'strip',
  }))
}

function PaymentSuccessCelebration({ celebration, onClose }) {
  const pieces = useMemo(
    () => (celebration ? createPaymentConfetti() : []),
    [celebration?.key],
  )

  useEffect(() => {
    if (!celebration) return undefined
    const timer = window.setTimeout(onClose, 5200)
    return () => window.clearTimeout(timer)
  }, [celebration, onClose])

  if (!celebration) return null

  const planLabel = celebration.planName ? `${celebration.planName} plan` : 'your plan'

  return (
    <div className="payment-celebration" role="status" aria-live="polite">
      <div className="payment-celebration-confetti" aria-hidden="true">
        {pieces.map((piece) => (
          <span
            key={piece.id}
            className={`payment-confetti-piece payment-confetti-piece--${piece.shape}`}
            style={{
              left: piece.left,
              width: piece.shape === 'strip' ? '3px' : piece.size,
              height: piece.shape === 'strip' ? '14px' : piece.size,
              backgroundColor: piece.color,
              animationDelay: piece.delay,
              animationDuration: piece.duration,
              '--confetti-drift': piece.drift,
              '--confetti-spin': piece.spin,
            }}
          />
        ))}
      </div>

      <div className="payment-celebration-card">
        <div className="payment-celebration-sparkles" aria-hidden="true">
          <span className="payment-celebration-spark payment-celebration-spark-1" />
          <span className="payment-celebration-spark payment-celebration-spark-2" />
          <span className="payment-celebration-spark payment-celebration-spark-3" />
          <span className="payment-celebration-spark payment-celebration-spark-4" />
        </div>
        <span className="payment-celebration-icon" aria-hidden="true">
          <FaIcon icon="circle-check" size={22} />
        </span>
        <p className="payment-celebration-title">Payment successful!</p>
        <p className="payment-celebration-message">
          {planLabel} is now active. Welcome aboard.
        </p>
        <button type="button" className="payment-celebration-dismiss" onClick={onClose}>
          Continue
        </button>
      </div>
    </div>
  )
}

function AppToast({ toast, onClose }) {
  if (!toast?.message) return null

  const variant = toast.variant || 'success'
  const isError = variant === 'error'

  return (
    <div className={`app-toast app-toast--${variant}`} role={isError ? 'alert' : 'status'}>
      <span className="app-toast-icon-wrap" aria-hidden="true">
        <FaIcon icon={isError ? 'circle-xmark' : 'circle-check'} size={18} />
      </span>
      <div className="app-toast-content">
        {toast.title ? <p className="app-toast-title">{toast.title}</p> : null}
        <p className="app-toast-message">{toast.message}</p>
      </div>
      {onClose ? (
        <button type="button" className="app-toast-close" onClick={onClose} aria-label="Dismiss notification">
          <FaIcon icon="xmark" size={14} />
        </button>
      ) : null}
    </div>
  )
}

function ConnectLoadingLabel({ label = 'Connecting…' }) {
  return (
    <span className="connect-loading-label">
      <FaIcon icon="spinner" size={13} className="connect-btn-spin" />
      {label}
    </span>
  )
}

function OAuthConnectingOverlay() {
  return null
}

function DriveFolderModal({ open, loading, foldersLoading, folders, selectedId, onSelect, onConfirm, onClose }) {
  useEffect(() => {
    if (!open) return undefined

    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !loading) onClose()
    }

    document.addEventListener('keydown', onKeyDown)
    lockPageScroll()
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      unlockPageScroll()
    }
  }, [open, loading, onClose])

  if (!open) return null

  return (
    <div className="connect-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="drive-folder-title">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close folder picker" onClick={() => !loading && onClose()} />
      <div className="connect-modal connect-modal--drive relative">
        <div className="connect-modal-header">
          <div className="connect-modal-header-icon connect-modal-header-icon--drive">
            <FaBrand icon="google-drive" size={20} />
          </div>
          <div className="min-w-0">
            <h2 id="drive-folder-title" className="connect-modal-title theme-heading">Choose a folder</h2>
            <p className="connect-modal-subtitle type-caption theme-muted">
              Select the Drive folder where resumes are stored
            </p>
          </div>
          <button type="button" className="connect-modal-close" onClick={onClose} disabled={loading} aria-label="Close">
            <FaIcon icon="xmark" size={14} />
          </button>
        </div>

        <div className="connect-modal-body">
          <div className="drive-folder-list" role="listbox" aria-label="Drive folders">
            {foldersLoading ? (
              Array.from({ length: 4 }, (_, index) => (
                <div key={index} className="drive-folder-skeleton" aria-hidden="true">
                  <div className="drive-folder-skeleton-icon" />
                  <div className="drive-folder-skeleton-line" />
                </div>
              ))
            ) : folders.length === 0 ? (
              <p className="drive-folder-empty type-caption theme-muted">No folders found in this Drive account.</p>
            ) : (
              folders.map((folder) => {
                const isSelected = selectedId === folder.id
                return (
                  <button
                    key={folder.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    disabled={loading}
                    onClick={() => onSelect(folder.id)}
                    className={`drive-folder-option${isSelected ? ' drive-folder-option-selected' : ''}`}
                  >
                    <span className="drive-folder-option-icon" aria-hidden="true">
                      <FaIcon icon="folder" size={16} />
                    </span>
                    <span className="drive-folder-option-copy min-w-0">
                      <span className="drive-folder-option-name theme-heading">{folder.name}</span>
                    </span>
                    {isSelected && (
                      <span className="drive-folder-option-check" aria-hidden="true">
                        <FaIcon icon="circle-check" size={16} />
                      </span>
                    )}
                  </button>
                )
              })
            )}
          </div>
        </div>

        <div className="connect-modal-footer">
          <button type="button" className="workspace-outline-btn type-button rounded-xl py-2.5 px-4" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button
            type="button"
            className="signup-continue-btn type-button text-white rounded-xl py-2.5 px-5"
            onClick={onConfirm}
            disabled={loading || !selectedId}
          >
            {loading ? 'Connecting…' : 'Connect folder'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ApiConnectModal({ open, loading, endpoint, apiKey, onEndpointChange, onApiKeyChange, onConnect, onClose }) {
  useEffect(() => {
    if (!open) return undefined

    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !loading) onClose()
    }

    document.addEventListener('keydown', onKeyDown)
    lockPageScroll()
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      unlockPageScroll()
    }
  }, [open, loading, onClose])

  if (!open) return null

  const canSubmit = endpoint.trim().length > 0 && apiKey.trim().length >= 8

  return (
    <div className="connect-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="api-connect-title">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close API connect modal" onClick={() => !loading && onClose()} />
      <div className="connect-modal connect-modal--api relative">
        <div className="connect-modal-header">
          <div className="connect-modal-header-icon connect-modal-header-icon--api">
            <FaIcon icon="plug" size={18} />
          </div>
          <div className="min-w-0">
            <h2 id="api-connect-title" className="connect-modal-title theme-heading">Connect your API</h2>
            <p className="connect-modal-subtitle type-caption theme-muted">
              Enter credentials to fetch CVs from your ATS or careers site
            </p>
          </div>
          <button type="button" className="connect-modal-close" onClick={onClose} disabled={loading} aria-label="Close">
            <FaIcon icon="xmark" size={14} />
          </button>
        </div>

        <div className="connect-modal-body connect-modal-body--form">
          <label className="connect-field">
            <span className="connect-field-label type-label theme-muted">API endpoint</span>
            <input
              type="url"
              value={endpoint}
              onChange={(e) => onEndpointChange(e.target.value)}
              placeholder="https://api.your-ats.com/v1/candidates"
              className="connect-field-input theme-input type-input rounded-xl px-3 py-2.5 w-full focus:outline-none"
              disabled={loading}
            />
          </label>
          <label className="connect-field">
            <span className="connect-field-label type-label theme-muted">API key</span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => onApiKeyChange(e.target.value)}
              placeholder="Paste your secret API key"
              className="connect-field-input theme-input type-input rounded-xl px-3 py-2.5 w-full focus:outline-none"
              disabled={loading}
            />
          </label>
          <p className="connect-field-hint type-caption theme-muted">
            <FaIcon icon="lock" size={11} /> Keys are encrypted and used only to pull CV attachments.
          </p>
        </div>

        <div className="connect-modal-footer">
          <button type="button" className="workspace-outline-btn type-button rounded-xl py-2.5 px-4" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button
            type="button"
            className="signup-continue-btn type-button text-white rounded-xl py-2.5 px-5"
            onClick={onConnect}
            disabled={loading || !canSubmit}
          >
            {loading ? 'Verifying…' : 'Connect & fetch CVs'}
          </button>
        </div>
      </div>
    </div>
  )
}

function AssignInboxModal({
  open,
  email,
  loading,
  members,
  selectedId,
  onSelect,
  onSkip,
  onAssign,
}) {
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!open) {
      setSearch('')
      return undefined
    }

    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !loading) onSkip()
    }

    document.addEventListener('keydown', onKeyDown)
    lockPageScroll()
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      unlockPageScroll()
    }
  }, [open, loading, onSkip])

  if (!open) return null

  const query = search.trim().toLowerCase()
  const filteredMembers = members.filter((member) => {
    if (!query) return true
    return (
      member.name.toLowerCase().includes(query)
      || member.email.toLowerCase().includes(query)
      || member.role.toLowerCase().includes(query)
    )
  })

  return (
    <div className="assign-inbox-overlay" role="dialog" aria-modal="true" aria-labelledby="assign-inbox-title">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close assign inbox modal" onClick={() => !loading && onSkip()} />
      <div className="assign-inbox-modal relative">
        <div className="assign-inbox-glow" aria-hidden="true" />

        <div className="assign-inbox-header">
          <div className="assign-inbox-header-icon">
            <FaIcon icon="envelope" size={20} />
          </div>
          <div className="min-w-0">
            <h2 id="assign-inbox-title" className="assign-inbox-title">Assign this inbox</h2>
            <p className="assign-inbox-subtitle">
              <span className="assign-inbox-email">{email}</span> is now connected
            </p>
          </div>
        </div>

        <div className="assign-inbox-body">
          <label className="type-label theme-muted mb-1.5 block" htmlFor="assign-inbox-search">Team member</label>
          <div className="assign-inbox-search-wrap">
            <FaIcon icon="magnifying-glass" size={14} className="assign-inbox-search-icon" />
            <input
              id="assign-inbox-search"
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name or email"
              className="assign-inbox-search theme-input type-input border rounded-xl pl-9 pr-3 py-2.5 w-full focus:outline-none"
              disabled={loading}
            />
          </div>

          <div className="assign-inbox-list" role="listbox" aria-label="Team members">
            {loading ? (
              Array.from({ length: 4 }, (_, index) => (
                <div key={index} className="assign-inbox-skeleton" aria-hidden="true">
                  <div className="assign-inbox-skeleton-avatar" />
                  <div className="assign-inbox-skeleton-lines">
                    <div className="assign-inbox-skeleton-line assign-inbox-skeleton-line-lg" />
                    <div className="assign-inbox-skeleton-line" />
                  </div>
                </div>
              ))
            ) : filteredMembers.length === 0 ? (
              <p className="assign-inbox-empty type-caption theme-muted">No team members match your search.</p>
            ) : (
              filteredMembers.map((member) => {
                const selected = selectedId === member.id
                return (
                  <button
                    key={member.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => onSelect(member.id)}
                    className={`assign-inbox-member ${selected ? 'assign-inbox-member-selected' : ''}`}
                  >
                    <span className="assign-inbox-member-avatar">{getInitials(member.name)}</span>
                    <span className="assign-inbox-member-info min-w-0">
                      <span className="assign-inbox-member-row">
                        <span className="assign-inbox-member-name">{member.name}</span>
                        <span className={`assign-inbox-role assign-inbox-role-${member.role.toLowerCase()}`}>
                          {member.role}
                        </span>
                      </span>
                      <span className="assign-inbox-member-email">{member.email}</span>
                    </span>
                    <span className={`assign-inbox-member-check ${selected ? 'assign-inbox-member-check-visible' : ''}`}>
                      <FaIcon icon="check" size={12} />
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </div>

        <div className="assign-inbox-footer">
          <button type="button" onClick={onSkip} disabled={loading} className="assign-inbox-skip type-caption">
            Skip for now
          </button>
          <button
            type="button"
            onClick={onAssign}
            disabled={loading || !selectedId}
            className="signin-btn-primary type-button text-white rounded-xl py-2.5 px-5"
          >
            Assign
          </button>
        </div>
      </div>
    </div>
  )
}

function SetupShell({ theme, onThemeChange, children }) {
  return (
    <div className="setup-page min-h-screen relative overflow-hidden flex items-center justify-center px-6 py-10">
      <div className="absolute top-6 right-6 z-20">
        <ThemeSwitcher theme={theme} onChange={onThemeChange} />
      </div>
      {children}
    </div>
  )
}

const DEFAULT_WORKSPACE_USAGE = {
  planId: 'demo',
  planName: 'Demo',
  subscriptionStatus: 'demo',
  priceInr: 0,
  priceLabel: 'Free',
  billingCycle: 'Trial access',
  renews: null,
  aiCredits: 100,
  aiCreditsMax: 100,
  aiCreditsUsed: 0,
  emailsIncluded: 50,
  emailsUsedThisMonth: 0,
  jobsUsed: 0,
  jobsMax: 10,
  gmailMax: 1,
  driveMax: 1,
  apiMax: 0,
  allowDrive: true,
  allowApi: false,
  singleConnector: true,
  isDemo: true,
  lastPayment: null,
  nextPayment: { date: 'After upgrade', amountInr: 300, label: 'Starter from ₹300/mo' },
}

const WORKSPACE_PLAN_USAGE = {
  demo: {
    label: 'Demo plan',
    planName: 'Demo',
    renews: null,
    priceInr: 0,
    priceLabel: 'Free',
    billingCycle: 'Trial access',
    lastPayment: null,
    nextPayment: {
      date: 'After upgrade',
      amountInr: 300,
      label: 'Starter from ₹300/mo',
    },
    aiCredits: 500,
    aiCreditsMax: 500,
    emailsIncluded: 1,
    emailsUsedThisMonth: 0,
    gmailMax: 1,
    allowDrive: false,
    allowApi: false,
    singleConnector: true,
  },
  growth: {
    label: 'Growth plan',
    planName: 'Growth',
    renews: 'Jul 24, 2026',
    priceInr: 900,
    priceLabel: '₹900',
    billingCycle: 'Billed monthly',
    lastPayment: {
      date: 'Jun 24, 2026',
      amountInr: 900,
      status: 'Paid',
      method: 'UPI',
    },
    nextPayment: {
      date: 'Jul 24, 2026',
      amountInr: 900,
      label: 'Growth plan renewal',
    },
    aiCredits: 1240,
    aiCreditsMax: 2000,
    emailsIncluded: 500,
    emailsUsedThisMonth: 186,
    gmailMax: 5,
    allowDrive: true,
    allowApi: true,
    singleConnector: false,
  },
}

const WORKSPACE_GROWTH_TEAM = [
  { id: 1, name: 'Abhay', email: 'abhay@deeptalent.in', role: 'Admin', inviteStatus: 'accepted', assignedInboxId: null },
  { id: 2, name: 'Richa', email: 'richa@deeptalent.in', role: 'Employee', inviteStatus: 'accepted', assignedInboxId: 1 },
  { id: 3, name: 'Mohit', email: 'mohit@deeptalent.in', role: 'Employee', inviteStatus: 'pending', assignedInboxId: null },
  { id: 4, name: 'Vikas', email: 'vikas@deeptalent.in', role: 'Employee', inviteStatus: 'accepted', assignedInboxId: 3 },
]

const WORKSPACE_GROWTH_GMAIL = [
  { id: 1, email: 'priya.recruiter@gmail.com', status: 'active', assignedMemberId: 4 },
  { id: 2, email: 'hiring.team@gmail.com', status: 'active', assignedMemberId: 3 },
  { id: 3, email: 'careers@gmail.com', status: 'needs_reconnect', assignedMemberId: 3 },
]

function InviteEmployeeModal({ open, onClose, onSend }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')

  useEffect(() => {
    if (!open) {
      setName('')
      setEmail('')
      return undefined
    }

    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', onKeyDown)
    lockPageScroll()
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      unlockPageScroll()
    }
  }, [open, onClose])

  if (!open) return null

  const canSend = name.trim().length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())

  const handleSend = () => {
    if (!canSend) return
    onSend({ name: name.trim(), email: email.trim() })
  }

  return (
    <div className="workspace-invite-overlay fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="invite-employee-title">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close" onClick={onClose} />
      <div className="workspace-invite-modal relative w-full max-w-md rounded-2xl p-6 md:p-7">
        <h2 id="invite-employee-title" className="type-section theme-heading">Invite employee</h2>
        <p className="type-caption theme-muted mt-1">They&apos;ll get temporary login credentials by email.</p>

        <label htmlFor="invite-name" className="type-label theme-muted mb-1.5 block mt-6">Name</label>
        <input
          id="invite-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Richa Sharma"
          className="signin-input theme-input type-input rounded-xl px-4 py-3 w-full focus:outline-none"
        />

        <label htmlFor="invite-email" className="type-label theme-muted mb-1.5 block mt-4">Email</label>
        <input
          id="invite-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="richa@deeptalent.in"
          className="signin-input theme-input type-input rounded-xl px-4 py-3 w-full focus:outline-none"
        />

        <div className="flex items-center justify-end gap-3 mt-7">
          <button type="button" onClick={onClose} className="workspace-outline-btn type-button rounded-xl py-2.5 px-5">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            className="signup-continue-btn type-button text-white rounded-xl py-2.5 px-5 disabled:opacity-45"
          >
            Send invite
          </button>
        </div>
      </div>
    </div>
  )
}

function BillingMetricCard({
  tone,
  icon,
  label,
  used,
  max,
  ringPct,
  barPct,
  foot,
  blocked = false,
  disabled = false,
  footTitle,
}) {
  const showRing = !disabled && ringPct != null
  const displayUsed = disabled ? '—' : used
  const displayMax = disabled ? null : max

  return (
    <article
      className={`billing-metric-card billing-metric-card--${tone}${blocked ? ' billing-metric-card--blocked' : ''}${disabled ? ' billing-metric-card--disabled' : ''}`}
    >
      <div className="billing-metric-card-accent" aria-hidden="true" />
      <div className="billing-metric-card-main">
        <div className="billing-metric-card-head">
          <div className="billing-metric-card-label-row">
            <span className="billing-metric-card-icon" aria-hidden="true">
              <FaIcon icon={icon} size={12} />
            </span>
            <span className="billing-metric-card-label">{label}</span>
          </div>
          {showRing && (
            <div
              className={`billing-metric-ring${blocked ? ' billing-metric-ring--muted' : ''}`}
              style={{ '--ring-pct': ringPct }}
              aria-hidden="true"
            >
              <span className="billing-metric-ring-inner">
                <span className="billing-metric-ring-num">{ringPct}</span>
              </span>
            </div>
          )}
        </div>
        <p className="billing-metric-card-stat theme-heading">
          {typeof displayUsed === 'number' ? displayUsed.toLocaleString('en-IN') : displayUsed}
          {displayMax != null && (
            <span className="billing-metric-card-of">
              {' / '}
              {typeof displayMax === 'number' ? displayMax.toLocaleString('en-IN') : displayMax}
            </span>
          )}
        </p>
        <div className="billing-metric-card-track" aria-hidden="true">
          <div
            className="billing-metric-card-track-fill"
            style={{ width: disabled ? '0%' : `${Math.min(100, barPct ?? 0)}%` }}
          />
        </div>
      </div>
      <p className="billing-metric-card-foot type-caption" title={footTitle}>
        {foot}
      </p>
    </article>
  )
}

const SCORING_WEIGHT_META = {
  skills_weight: { icon: 'code', hint: 'Technical skills & role fit', shortLabel: 'Skills' },
  experience_weight: { icon: 'briefcase', hint: 'Years of relevant experience', shortLabel: 'Experience' },
  education_weight: { icon: 'graduation-cap', hint: 'Degree & field alignment', shortLabel: 'Education' },
  location_weight: { icon: 'location-dot', hint: 'Geography & work location', shortLabel: 'Location' },
  profile_weight: { icon: 'circle-user', hint: 'Resume completeness & detail', shortLabel: 'Profile' },
  recency_weight: { icon: 'clock', hint: 'How recently they applied', shortLabel: 'Recency' },
}

function ScoringWeightsSettings({ isAdmin, onShowSuccess, onShowError }) {
  const [weights, setWeights] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    fetchScoringWeights()
      .then((data) => {
        if (!cancelled) setWeights(data)
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Could not load scoring weights')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <div className="scoring-weights-settings scoring-weights-settings--viewport" aria-label="Loading scoring weights" role="status">
        <div className="scoring-weights-layout">
          <div className="scoring-weights-card scoring-weights-skeleton-card">
            <Skeleton className="scoring-weights-skeleton-head" />
            <div className="scoring-weights-grid">
              {SCORING_WEIGHT_FIELDS.map((key) => (
                <div key={key} className="scoring-weight-item scoring-weight-item--skeleton">
                  <Skeleton className="ez-skeleton-circle-sm scoring-weight-icon-skeleton" />
                  <div className="scoring-weight-item-body">
                    <Skeleton className="ez-skeleton-line ez-skeleton-line-sm" />
                    <Skeleton className="ez-skeleton-line ez-skeleton-track mt-2" />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <Skeleton className="scoring-weights-skeleton-sidebar" />
        </div>
      </div>
    )
  }

  if (loadError || !weights) {
    return (
      <div className="scoring-weights-error" role="alert">
        <p className="scoring-weights-error-text">{loadError || 'Could not load scoring weights'}</p>
        <button
          type="button"
          className="workspace-outline-btn type-button rounded-xl py-2 px-4"
          onClick={() => {
            setLoading(true)
            setLoadError(null)
            fetchScoringWeights()
              .then(setWeights)
              .catch((err) => setLoadError(err instanceof Error ? err.message : 'Could not load scoring weights'))
              .finally(() => setLoading(false))
          }}
        >
          Try again
        </button>
      </div>
    )
  }

  const total = getScoringWeightsTotal(weights)
  const isValid = isValidScoringWeights(weights)
  const busy = saving || resetting

  const handleWeightChange = (key, rawValue) => {
    const value = Math.max(0, Math.min(100, Math.round(Number(rawValue) || 0)))
    setWeights((prev) => ({ ...prev, [key]: value }))
  }

  const handleSave = async () => {
    if (!isAdmin || !isValid || busy) return
    setSaving(true)
    try {
      await saveScoringWeights(weights)
      onShowSuccess?.(
        'Scoring weights updated. New scans will use these — existing candidate scores aren\'t retroactively changed.',
      )
    } catch (err) {
      onShowError?.(err instanceof Error ? err.message : 'Could not save scoring weights')
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async () => {
    if (!isAdmin || busy) return
    setResetting(true)
    try {
      const defaults = await resetScoringWeights()
      setWeights(defaults)
      onShowSuccess?.('Scoring weights reset to defaults.')
    } catch (err) {
      onShowError?.(err instanceof Error ? err.message : 'Could not reset scoring weights')
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className="scoring-weights-settings scoring-weights-settings--viewport">
      {!isAdmin && (
        <div className="scoring-weights-readonly-banner scoring-weights-readonly-banner--compact" role="status">
          <FaIcon icon="lock" size={11} />
          <span className="scoring-weights-readonly-copy type-caption">View only — admins can edit weights.</span>
        </div>
      )}

      <div className="scoring-weights-layout">
        <div className="scoring-weights-card">
          <div className="scoring-weights-card-head">
            <div className="scoring-weights-card-head-copy">
              <h2 className="scoring-weights-card-title theme-heading">Scoring weights</h2>
            </div>
            <div className="scoring-weights-distribution" aria-hidden="true">
              {SCORING_WEIGHT_FIELDS.map((key) => (
                <span
                  key={key}
                  className="scoring-weights-distribution-segment"
                  style={{ flexGrow: Math.max(weights[key], 0.001) }}
                  title={`${SCORING_WEIGHT_LABELS[key]}: ${weights[key]}%`}
                />
              ))}
            </div>
          </div>

          <div className="scoring-weights-grid">
            {SCORING_WEIGHT_FIELDS.map((key) => {
              const meta = SCORING_WEIGHT_META[key]
              const value = weights[key]
              return (
                <label
                  key={key}
                  className="scoring-weight-item"
                  style={{ '--weight-pct': `${value}%` }}
                  title={`${SCORING_WEIGHT_LABELS[key]} — ${meta.hint}`}
                >
                  <span className="scoring-weight-icon" aria-hidden="true">
                    <FaIcon icon={meta.icon} size={12} />
                  </span>
                  <div className="scoring-weight-item-body">
                    <div className="scoring-weight-item-top">
                      <span className="scoring-weight-label theme-heading">{meta.shortLabel}</span>
                      <span className="scoring-weight-value" aria-hidden="true">{value}%</span>
                    </div>
                    <div className="scoring-weight-slider-wrap">
                      <input
                        type="range"
                        className="scoring-weight-slider"
                        min={0}
                        max={100}
                        step={1}
                        value={value}
                        disabled={!isAdmin || busy}
                        aria-label={`${SCORING_WEIGHT_LABELS[key]} weight`}
                        onChange={(e) => handleWeightChange(key, e.target.value)}
                      />
                    </div>
                  </div>
                </label>
              )
            })}
          </div>
        </div>

        <aside className="scoring-weights-sidebar">
          <div className={`scoring-weights-summary${isValid ? ' scoring-weights-summary--valid' : ' scoring-weights-summary--invalid'}`}>
            <div className="scoring-weights-ring" style={{ '--ring-pct': total }}>
              <svg className="scoring-weights-ring-svg" viewBox="0 0 44 44" aria-hidden="true">
                <circle className="scoring-weights-ring-track" cx="22" cy="22" r="18" />
                <circle className="scoring-weights-ring-progress" cx="22" cy="22" r="18" />
              </svg>
              <div className="scoring-weights-ring-center">
                <span className="scoring-weights-ring-value">{total}</span>
              </div>
            </div>
            <div className="scoring-weights-summary-copy">
              <p className="scoring-weights-summary-title theme-heading">
                {isValid ? 'Balanced' : 'Reach 100%'}
              </p>
              <p className="scoring-weights-summary-sub type-caption theme-muted">
                {isValid ? 'Ready to save' : (total < 100 ? `${100 - total}% left` : `${total - 100}% over`)}
              </p>
            </div>
            {isValid && (
              <span className="scoring-weights-summary-badge" aria-hidden="true">
                <FaIcon icon="circle-check" size={11} />
              </span>
            )}
          </div>

          {isAdmin ? (
            <div className="scoring-weights-footer">
              <p className="scoring-weights-note type-caption theme-muted">
                Applies to future scoring only.
              </p>
              <div className="scoring-weights-actions">
                <button
                  type="button"
                  className="scoring-weights-save signup-continue-btn type-button text-white"
                  disabled={!isValid || busy}
                  onClick={handleSave}
                  title={!isValid ? 'Weights must sum to exactly 100 before saving' : 'Applies to candidates scored after save only'}
                >
                  <FaIcon icon="floppy-disk" size={10} />
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  className="scoring-weights-reset workspace-outline-btn type-button rounded-xl py-2 px-3"
                  disabled={busy}
                  onClick={handleReset}
                >
                  <FaIcon icon="rotate-left" size={10} />
                  Reset
                </button>
              </div>
            </div>
          ) : (
            <div className="scoring-weights-footer scoring-weights-footer--readonly">
              <p className="scoring-weights-note type-caption theme-muted">
                View current workspace priorities. Admins can edit and save.
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

function WorkspaceScreen({
  theme,
  onThemeChange,
  usage,
  billingLoading,
  initialTab = 'billing',
  isAdmin,
  teamMembers,
  gmailConnections,
  driveConnection,
  driveConnecting = false,
  apiConnection,
  activeConnector,
  onConnectSource,
  onDisconnectDrive,
  onChangeDriveFolder,
  onUpgrade,
  onInviteEmployee,
  onDisconnectGmail,
  onReconnectGmail,
  onAssignTeamInbox,
  onSuspendTeamMember,
  onDeleteTeamMember,
  onGoToDashboard,
  onShowSuccess,
  onShowError,
  gmailConnecting = false,
  gmailConnectingConnectionId = null,
}) {
  const [activeTab, setActiveTab] = useState(initialTab)
  const [selectedSourceId, setSelectedSourceId] = useState('gmail')
  const [inviteName, setInviteName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteSending, setInviteSending] = useState(false)

  useEffect(() => {
    setActiveTab(initialTab)
  }, [initialTab])

  const aiPercent = usage.aiCreditsMax > 0
    ? Math.round((usage.aiCredits / usage.aiCreditsMax) * 100)
    : 0
  const aiUsedPercent = usage.aiCreditsMax > 0
    ? Math.round(((usage.aiCreditsUsed ?? (usage.aiCreditsMax - usage.aiCredits)) / usage.aiCreditsMax) * 100)
    : 0
  const isDemo = usage.isDemo
  const gmailUsed = gmailConnections.length
  const driveUsed = driveConnection ? 1 : 0
  const driveFolderLinked = driveConnection && driveHasFolder(driveConnection)
  const driveAccountEmail = getDriveAccountEmail(driveConnection)
  const apiUsed = apiConnection ? 1 : 0
  const driveMax = usage.driveMax ?? 0
  const apiMax = usage.apiMax ?? 0
  const gmailUsedPercent = usage.gmailMax > 0
    ? Math.min(100, Math.round((gmailUsed / usage.gmailMax) * 100))
    : 0
  const driveUsedPercent = driveMax > 0
    ? Math.min(100, Math.round((driveUsed / driveMax) * 100))
    : 0
  const apiUsedPercent = apiMax > 0
    ? Math.min(100, Math.round((apiUsed / apiMax) * 100))
    : 0
  const demoDriveInUse = isDemo && usage.singleConnector && (driveConnection || activeConnector === 'drive')
  const demoGmailInUse = isDemo && usage.singleConnector && (gmailUsed > 0 || activeConnector === 'gmail')
  const apiDisabled = isDemo && !usage.allowApi
  const emailsUsedThisMonth = usage.emailsUsedThisMonth ?? 0
  const emailsUsedPercent = usage.emailsIncluded > 0
    ? Math.min(100, Math.round((emailsUsedThisMonth / usage.emailsIncluded) * 100))
    : 0

  const handleInviteSubmit = async (event) => {
    event.preventDefault()
    const name = inviteName.trim()
    const email = inviteEmail.trim()
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return

    setInviteSending(true)
    await onInviteEmployee({ name, email })
    setInviteName('')
    setInviteEmail('')
    setInviteSending(false)
  }

  const canSendInvite = inviteName.trim().length > 0
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail.trim())
    && !inviteSending

  const teamAcceptedCount = teamMembers.filter((m) => (m.inviteStatus || 'accepted') === 'accepted').length
  const teamPendingCount = teamMembers.filter((m) => m.inviteStatus === 'pending').length

  const connectorDisabled = (optionId) => {
    if (optionId === 'gmail' && gmailConnecting) return true
    if (optionId === 'gmail' && gmailUsed >= usage.gmailMax) return true
    if (optionId === 'drive' && driveConnecting) return true
    if (optionId === 'drive' && driveConnection) return true
    if (optionId === 'drive' && !usage.allowDrive && !isDemo) return true
    if (optionId === 'api' && !usage.allowApi && !isDemo) return true
    if (usage.singleConnector && activeConnector && activeConnector !== optionId) {
      if (optionId === 'gmail' && gmailUsed > 0) return false
      if (optionId === 'drive' && driveConnection) return false
      if (optionId === 'api' && apiConnection) return false
      return true
    }
    return false
  }

  const getSourceStatus = (optionId) => {
    if (optionId === 'gmail') {
      if (gmailUsed > 0) return 'connected'
      if (gmailUsed >= usage.gmailMax) return 'limit'
    }
    if (optionId === 'drive' && driveFolderLinked) return 'connected'
    if (optionId === 'api' && (apiConnection || activeConnector === 'api')) return 'connected'
    if (!isDemo && optionId === 'drive' && !usage.allowDrive) return 'locked'
    if (!isDemo && optionId === 'api' && !usage.allowApi) return 'locked'
    if (connectorDisabled(optionId)) return 'disabled'
    return 'available'
  }

  const sourceActionLabel = (option) => {
    const status = getSourceStatus(option.id)
    if (status === 'connected') {
      if (option.id === 'gmail' && gmailUsed < usage.gmailMax) return 'Add inbox'
      return 'Manage'
    }
    if (status === 'locked') return 'Upgrade'
    if (status === 'limit') return 'Limit reached'
    return 'Connect'
  }

  const handleSourceClick = (option) => {
    const status = getSourceStatus(option.id)
    if (status === 'locked') {
      onUpgrade()
      return
    }
    if (option.id === 'gmail' && gmailConnecting) return
    if (option.id === 'drive' && driveConnecting) return
    if (connectorDisabled(option.id) || status === 'limit') return
    onConnectSource(option)
  }

  const selectedSource = SCAN_SOURCE_OPTIONS.find((o) => o.id === selectedSourceId) || SCAN_SOURCE_OPTIONS[0]
  const selectedStatus = getSourceStatus(selectedSource.id)
  const selectedAction = sourceActionLabel(selectedSource)
  const gmailCtaLoading = gmailConnecting && selectedSourceId === 'gmail' && !gmailConnectingConnectionId
  const driveCtaLoading = driveConnecting && selectedSourceId === 'drive'
  const showConnectCta = selectedSourceId !== 'drive' || !driveConnection
  const selectedDisabled = selectedStatus === 'disabled' || selectedStatus === 'limit'
    || (!isAdmin && selectedSource.id === 'gmail' && selectedStatus !== 'connected')
    || gmailCtaLoading
    || driveCtaLoading

  const statusLabel = (status) => {
    if (status === 'connected') return 'Connected'
    if (status === 'available') return 'Available'
    if (status === 'locked') return 'Upgrade'
    if (status === 'limit') return 'Limit reached'
    return 'Unavailable'
  }

  return (
    <div className="setup-page workspace-page relative overflow-hidden">
      <div className="workspace-shell">
        <header className="workspace-topbar">
          <Logo className="text-lg" />
          <div className="workspace-topbar-actions">
            <button type="button" onClick={onGoToDashboard} className="workspace-outline-btn type-button rounded-xl py-2 px-4">
              Go to dashboard
            </button>
            <ThemeSwitcher theme={theme} onChange={onThemeChange} />
          </div>
        </header>

        <div className="workspace-tabs" role="tablist" aria-label="Workspace settings">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'billing'}
            className={`workspace-tab ${activeTab === 'billing' ? 'workspace-tab-active' : ''}`}
            onClick={() => setActiveTab('billing')}
          >
            <FaIcon icon="chart-pie" size={12} />
            Billing &amp; usage
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'connect'}
            className={`workspace-tab ${activeTab === 'connect' ? 'workspace-tab-active' : ''}`}
            onClick={() => setActiveTab('connect')}
          >
            <FaIcon icon="plug" size={12} />
            Connect source
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'scoring'}
            className={`workspace-tab ${activeTab === 'scoring' ? 'workspace-tab-active' : ''}`}
            onClick={() => setActiveTab('scoring')}
          >
            <FaIcon icon="sliders" size={12} />
            Scoring weights
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'team'}
            className={`workspace-tab ${activeTab === 'team' ? 'workspace-tab-active' : ''}`}
            onClick={() => setActiveTab('team')}
          >
            <FaIcon icon="users" size={12} />
            Team
            {teamMembers.length > 0 && (
              <span className="workspace-tab-badge">{teamMembers.length}</span>
            )}
          </button>
        </div>

        <div className="workspace-tab-panels">
          {activeTab === 'billing' && (
            <section className="workspace-tab-panel workspace-billing-panel" role="tabpanel">
              {billingLoading ? (
                <BillingPanelSkeleton />
              ) : (
              <div className="billing-dashboard billing-dashboard--viewport">
                <div className="billing-bento-top">
                  <div className="billing-plan-card">
                    <span className="billing-plan-card-glow" aria-hidden="true" />
                    <span className="billing-plan-card-glow billing-plan-card-glow-2" aria-hidden="true" />
                    <div className="billing-plan-card-inner">
                      <div className="billing-plan-head-row">
                        <span className="billing-plan-badge">{usage.planName}</span>
                        <button
                          type="button"
                          onClick={onUpgrade}
                          className="billing-plan-cta signup-continue-btn type-button text-white"
                        >
                          <FaIcon icon="arrow-trend-up" size={12} />
                          Upgrade plan
                        </button>
                      </div>
                      <div className="billing-plan-price-block">
                        <span className="billing-plan-price theme-heading">{usage.priceLabel}</span>
                        <span className="billing-plan-cycle type-caption theme-muted">{usage.billingCycle}</span>
                      </div>
                      <p className="billing-plan-desc type-caption theme-muted">
                        {usage.renews ? `Renews ${usage.renews}` : 'Upgrade anytime for more connectors'}
                        {' · '}
                        {usage.emailsIncluded} email{usage.emailsIncluded === 1 ? '' : 's'} included
                      </p>
                    </div>
                  </div>

                  <div className="billing-pay-stack">
                    <article className="billing-pay-tile billing-pay-tile--paid">
                      <div className="billing-pay-tile-head">
                        <span className="billing-pay-tile-icon" aria-hidden="true">
                          <FaIcon icon="circle-check" size={14} />
                        </span>
                        <span className="billing-pay-tile-label type-label theme-muted">Last payment</span>
                      </div>
                      {usage.lastPayment ? (
                        <>
                          <p className="billing-pay-tile-amount theme-heading">
                            ₹{usage.lastPayment.amountInr.toLocaleString('en-IN')}
                          </p>
                          <p className="billing-pay-tile-meta type-caption theme-muted">
                            {usage.lastPayment.date} · {usage.lastPayment.method}
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="billing-pay-tile-amount theme-heading">—</p>
                          <p className="billing-pay-tile-meta type-caption theme-muted">
                            {isDemo ? 'No payments on Demo yet' : 'No payments recorded yet'}
                          </p>
                        </>
                      )}
                    </article>

                    <article className="billing-pay-tile billing-pay-tile--upcoming">
                      <div className="billing-pay-tile-head">
                        <span className="billing-pay-tile-icon" aria-hidden="true">
                          <FaIcon icon="calendar-days" size={14} />
                        </span>
                        <span className="billing-pay-tile-label type-label theme-muted">Upcoming</span>
                      </div>
                      {usage.nextPayment ? (
                        <>
                          <p className="billing-pay-tile-amount theme-heading">
                            {usage.nextPayment.amountInr > 0
                              ? `₹${usage.nextPayment.amountInr.toLocaleString('en-IN')}`
                              : '—'}
                          </p>
                          <p className="billing-pay-tile-meta type-caption theme-muted">
                            {usage.nextPayment.date}
                            {usage.nextPayment.label ? ` · ${usage.nextPayment.label}` : ''}
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="billing-pay-tile-amount theme-heading">—</p>
                          <p className="billing-pay-tile-meta type-caption theme-muted">No upcoming charges</p>
                        </>
                      )}
                    </article>
                  </div>
                </div>

                <div className="billing-usage-block">
                  <h3 className="billing-usage-title theme-heading">Usage this cycle</h3>

                  <div className="billing-usage-grid">
                    <BillingMetricCard
                      tone="ai"
                      icon="brain"
                      label="AI credits"
                      used={usage.aiCredits}
                      max={usage.aiCreditsMax}
                      ringPct={aiPercent}
                      barPct={aiUsedPercent}
                      foot={`${aiUsedPercent}% used · parsing & ranking`}
                    />
                    <BillingMetricCard
                      tone="email"
                      icon="envelope"
                      label="Emails"
                      used={emailsUsedThisMonth}
                      max={usage.emailsIncluded}
                      ringPct={100 - emailsUsedPercent}
                      barPct={emailsUsedPercent}
                      foot={`${emailsUsedThisMonth} sent this cycle`}
                    />
                    <BillingMetricCard
                      tone="inbox"
                      icon="inbox"
                      label="Gmail slots"
                      used={gmailUsed}
                      max={usage.gmailMax}
                      ringPct={100 - gmailUsedPercent}
                      barPct={gmailUsedPercent}
                      blocked={demoDriveInUse}
                      footTitle={demoDriveInUse ? 'Drive connected — Demo allows one connector' : undefined}
                      foot={demoDriveInUse
                        ? 'Drive in use · Demo limit'
                        : gmailUsedPercent >= 100
                          ? 'All slots in use'
                          : `${usage.gmailMax - gmailUsed} available`}
                    />
                    <BillingMetricCard
                      tone="drive"
                      icon="folder"
                      label="Drive connection"
                      used={driveUsed}
                      max={driveMax || 1}
                      ringPct={driveMax > 0 ? 100 - driveUsedPercent : 0}
                      barPct={driveUsedPercent}
                      blocked={demoGmailInUse}
                      footTitle={demoGmailInUse ? 'Gmail connected — Demo allows one connector' : undefined}
                      foot={demoGmailInUse
                        ? 'Gmail in use · Demo limit'
                        : driveUsed >= driveMax
                          ? 'Folder linked'
                          : `${Math.max(driveMax - driveUsed, 0)} available`}
                    />
                    <BillingMetricCard
                      tone="api"
                      icon="plug"
                      label="API connection"
                      used={apiDisabled ? '—' : apiUsed}
                      max={apiDisabled ? null : apiMax}
                      ringPct={apiDisabled ? null : apiMax > 0 ? 100 - apiUsedPercent : 0}
                      barPct={apiDisabled ? 0 : apiUsedPercent}
                      disabled={apiDisabled}
                      foot={apiDisabled
                        ? 'Not on Demo plan'
                        : apiUsed >= apiMax
                          ? 'Endpoint connected'
                          : `${Math.max(apiMax - apiUsed, 0)} available`}
                    />
                  </div>
                </div>
              </div>
              )}
            </section>
          )}

          {activeTab === 'connect' && (
            <section className="workspace-tab-panel workspace-connect-panel" role="tabpanel">
              <div className="connect-dashboard">
                <header className="connect-hero">
                  <h2 className="connect-hero-title theme-heading">Data sources</h2>
                </header>

                <div className="connect-split">
                  <div className="connect-nav-wrap">
                    <p className="connect-nav-heading type-label theme-muted">Connectors</p>
                    <nav className="connect-nav" aria-label="Source types">
                      {SCAN_SOURCE_OPTIONS.map((option) => {
                        const status = getSourceStatus(option.id)
                        const isActive = selectedSourceId === option.id
                        return (
                          <button
                            key={option.id}
                            type="button"
                            className={`connect-nav-item${isActive ? ' connect-nav-item-active' : ''}${status === 'connected' ? ' connect-nav-item-connected' : ''}`}
                            onClick={() => setSelectedSourceId(option.id)}
                          >
                            <span className={`connect-nav-icon connect-nav-icon--${option.tone}`}>
                              {option.brand ? (
                                <FaBrand icon={option.icon} size={16} />
                              ) : (
                                <FaIcon icon={option.icon} size={15} />
                              )}
                            </span>
                            <span className="connect-nav-copy min-w-0">
                              <span className="connect-nav-label">{option.title}</span>
                              <span className="connect-nav-status type-caption theme-muted">
                                {status === 'connected' ? 'Connected' : status === 'locked' ? 'Upgrade' : 'Not linked'}
                              </span>
                            </span>
                            <span className={`connect-nav-dot connect-nav-dot--${status}`} aria-hidden="true" />
                          </button>
                        )
                      })}
                    </nav>
                  </div>

                  <div className="connect-detail">
                    <div className="connect-detail-head">
                      <span className={`connect-detail-icon connect-detail-icon--${selectedSource.tone}`}>
                        {selectedSource.brand ? (
                          <FaBrand icon={selectedSource.icon} size={22} />
                        ) : (
                          <FaIcon icon={selectedSource.icon} size={20} />
                        )}
                      </span>
                      <div className="connect-detail-head-copy min-w-0">
                        <div className="connect-detail-title-row">
                          <h3 className="connect-detail-title theme-heading">{selectedSource.title}</h3>
                          <span className={`connect-detail-badge connect-detail-badge--${selectedStatus}`}>
                            {statusLabel(selectedStatus)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="connect-detail-actions">
                      {showConnectCta && (isAdmin || selectedSourceId !== 'gmail' || selectedStatus === 'connected') && (
                        <button
                          type="button"
                          disabled={selectedDisabled}
                          onClick={() => handleSourceClick(selectedSource)}
                          className={`connect-detail-cta${selectedStatus === 'locked' ? ' workspace-outline-btn' : ' signup-continue-btn text-white'} type-button rounded-xl py-2.5 px-5`}
                        >
                          {gmailCtaLoading || driveCtaLoading ? (
                            <ConnectLoadingLabel />
                          ) : (
                            <>
                              <FaIcon icon={selectedStatus === 'locked' ? 'arrow-trend-up' : 'plug'} size={13} />
                              {selectedAction}
                            </>
                          )}
                        </button>
                      )}
                    </div>

                    {selectedSourceId === 'gmail' && (
                      <div className="connect-detail-body">
                        <div className="connect-detail-meta">
                          <span className="connect-detail-meta-label type-label theme-muted">Plan usage</span>
                          <span className="connect-detail-meta-value theme-heading">
                            {gmailUsed} / {usage.gmailMax} inboxes
                          </span>
                        </div>

                        {gmailConnections.length === 0 ? (
                          <div className="connect-detail-empty">
                            <FaIcon icon="envelope-open" size={22} />
                            <p className="type-body theme-heading">No Gmail connected</p>
                            <p className="type-caption theme-muted">Authorize Google to scan application emails for CVs.</p>
                          </div>
                        ) : (
                          <ul className="connect-gmail-list">
                            {gmailConnections.map((connection) => {
                              const isDisconnected = connection.status === 'needs_reconnect'
                              const rowConnecting = gmailConnecting && gmailConnectingConnectionId === connection.id
                              return (
                                <li
                                  key={connection.id}
                                  className={`connect-gmail-row${isDisconnected ? ' connect-gmail-row--disconnected' : ''}`}
                                >
                                  <div className="connect-gmail-row-main min-w-0">
                                    <span className={`connect-gmail-avatar${isDisconnected ? ' connect-gmail-avatar--disconnected' : ''}`}>
                                      {getInitials(connection.email.split('@')[0])}
                                    </span>
                                    <div className="min-w-0">
                                      <p className={`connect-gmail-email theme-heading truncate${isDisconnected ? ' connect-gmail-email--disconnected' : ''}`}>
                                        {connection.email}
                                      </p>
                                      {isDisconnected && (
                                        <p className="connect-gmail-disconnected-note type-caption">
                                          Disconnected — reconnect to resume scanning
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                  <div className="connect-gmail-row-actions">
                                    {isDisconnected ? (
                                      <>
                                        <span className="connect-gmail-status connect-gmail-status--disconnected">Disconnected</span>
                                        <button
                                          type="button"
                                          className="connect-gmail-btn connect-gmail-btn-connect"
                                          disabled={gmailConnecting}
                                          onClick={() => onReconnectGmail(connection.id)}
                                        >
                                          {rowConnecting ? (
                                            <ConnectLoadingLabel label="Connecting…" />
                                          ) : (
                                            <>
                                              <FaIcon icon="plug" size={11} />
                                              Connect
                                            </>
                                          )}
                                        </button>
                                      </>
                                    ) : (
                                      <>
                                        <span className="connect-gmail-status connect-gmail-status--active">Active</span>
                                        <button
                                          type="button"
                                          className="connect-gmail-btn connect-gmail-btn-disconnect"
                                          disabled={gmailConnecting}
                                          onClick={() => onDisconnectGmail(connection.id)}
                                        >
                                          Disconnect
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </li>
                              )
                            })}
                          </ul>
                        )}

                        {isAdmin && gmailUsed < usage.gmailMax && gmailConnections.length > 0 && !gmailConnecting && (
                          <button
                            type="button"
                            className="connect-detail-secondary"
                            onClick={() => handleSourceClick(selectedSource)}
                            disabled={connectorDisabled('gmail')}
                          >
                            <FaIcon icon="plus" size={11} />
                            Add another inbox
                          </button>
                        )}
                      </div>
                    )}

                    {selectedSourceId === 'drive' && (
                      <div className="connect-detail-body">
                        {driveConnection && (
                          <>
                            {driveAccountEmail ? (
                              <ul className="connect-gmail-list connect-drive-account-list">
                                <li className="connect-gmail-row">
                                  <div className="connect-gmail-row-main min-w-0">
                                    <span className="connect-gmail-avatar connect-gmail-avatar--drive">
                                      <FaBrand icon="google-drive" size={14} />
                                    </span>
                                    <div className="min-w-0">
                                      <p className="connect-gmail-email theme-heading truncate">{driveAccountEmail}</p>
                                      <p className="type-caption theme-muted">Google account linked</p>
                                    </div>
                                  </div>
                                  <div className="connect-gmail-row-actions">
                                    <span className="connect-gmail-status connect-gmail-status--active">Active</span>
                                    <button
                                      type="button"
                                      className="connect-gmail-btn connect-gmail-btn-disconnect"
                                      onClick={onDisconnectDrive}
                                      disabled={driveConnecting}
                                    >
                                      Disconnect
                                    </button>
                                  </div>
                                </li>
                              </ul>
                            ) : (
                              <div className="connect-drive-account-fallback">
                                <div className="connect-drive-connected connect-drive-connected--account">
                                  <FaBrand icon="google-drive" size={16} />
                                  <span>Google Drive account connected</span>
                                </div>
                                <button
                                  type="button"
                                  className="connect-gmail-btn connect-gmail-btn-disconnect"
                                  onClick={onDisconnectDrive}
                                  disabled={driveConnecting}
                                >
                                  Disconnect
                                </button>
                              </div>
                            )}

                            {!driveFolderLinked && (
                              <div className="connect-detail-empty connect-drive-folder-empty">
                                <FaBrand icon="google-drive" size={24} />
                                <p className="type-body theme-heading">No folder linked</p>
                                <p className="type-caption theme-muted">
                                  Pick the Drive folder to import resumes from.
                                </p>
                                <button
                                  type="button"
                                  className="connect-detail-secondary mt-3"
                                  onClick={onChangeDriveFolder}
                                  disabled={driveConnecting}
                                >
                                  <FaIcon icon="folder-open" size={11} />
                                  Choose folder
                                </button>
                              </div>
                            )}

                            {driveFolderLinked && (
                              <>
                                <div className="connect-drive-connected">
                                  <FaIcon icon="circle-check" size={16} />
                                  <span>
                                    Connected — scanning &ldquo;{driveConnection.folder_name}&rdquo;
                                  </span>
                                </div>
                                <div className="connect-drive-actions">
                                  <button
                                    type="button"
                                    className="connect-gmail-btn connect-gmail-btn-disconnect"
                                    onClick={onChangeDriveFolder}
                                    disabled={driveConnecting}
                                  >
                                    Change folder
                                  </button>
                                </div>
                              </>
                            )}
                          </>
                        )}
                      </div>
                    )}

                    {selectedSourceId === 'api' && (
                      <div className="connect-detail-body">
                        {apiConnection ? (
                          <>
                            <div className="connect-detail-meta">
                              <span className="connect-detail-meta-label type-label theme-muted">Endpoint</span>
                              <span className="connect-detail-meta-value theme-heading truncate">{apiConnection.endpoint}</span>
                            </div>
                            <div className="connect-linked-item">
                              <span className="connect-linked-item-icon connect-linked-item-icon--api" aria-hidden="true">
                                <FaIcon icon="link" size={14} />
                              </span>
                              <div className="min-w-0">
                                <p className="connect-linked-item-title theme-heading truncate">{apiConnection.endpoint}</p>
                                <p className="connect-linked-item-path type-caption theme-muted">
                                  Key {apiConnection.keyPreview}
                                </p>
                              </div>
                              <span className="connect-linked-item-status">Live</span>
                            </div>
                          </>
                        ) : (
                          <div className="connect-detail-empty">
                            <FaIcon icon="plug" size={22} />
                            <p className="type-body theme-heading">No API configured</p>
                            <p className="type-caption theme-muted">
                              Enter your ATS endpoint and API key to pull candidate CVs automatically.
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>
          )}

          {activeTab === 'scoring' && (
            <section className="workspace-tab-panel workspace-scoring-panel" role="tabpanel">
              <ScoringWeightsSettings
                isAdmin={isAdmin}
                onShowSuccess={onShowSuccess}
                onShowError={onShowError}
              />
            </section>
          )}

          {activeTab === 'team' && (
            <section className="workspace-tab-panel workspace-team-panel" role="tabpanel">
              <div className="team-dashboard">
                <header className="team-hero">
                  <div className="team-hero-main">
                    <h2 className="team-hero-title theme-heading">Team</h2>
                    <p className="team-hero-sub type-caption theme-muted">
                      Invite colleagues and assign inboxes
                    </p>
                  </div>
                  <div className="team-stats">
                    <span className="team-stat">
                      <FaIcon icon="users" size={11} />
                      {teamMembers.length} total
                    </span>
                    <span className="team-stat team-stat--accepted">
                      <FaIcon icon="circle-check" size={11} />
                      {teamAcceptedCount} active
                    </span>
                    {teamPendingCount > 0 && (
                      <span className="team-stat team-stat--pending">
                        <FaIcon icon="clock" size={11} />
                        {teamPendingCount} pending
                      </span>
                    )}
                  </div>
                </header>

                <article className="team-invite-card">
                  <div className="team-invite-head">
                    <span className="team-invite-head-icon" aria-hidden="true">
                      <FaIcon icon="user-plus" size={16} />
                    </span>
                    <div className="min-w-0">
                      <h3 className="team-invite-title theme-heading">Invite teammate</h3>
                      <p className="team-invite-sub type-caption theme-muted">
                        They&apos;ll receive an email to join your workspace
                      </p>
                    </div>
                  </div>

                  <form className="team-invite-form" onSubmit={handleInviteSubmit}>
                    <label className="team-invite-field">
                      <span className="team-invite-label type-label theme-muted">Name</span>
                      <div className="team-invite-input-wrap">
                        <FaIcon icon="user" size={12} className="team-invite-input-icon" />
                        <input
                          type="text"
                          value={inviteName}
                          onChange={(e) => setInviteName(e.target.value)}
                          placeholder="Full name"
                          className="team-invite-input theme-input type-input w-full focus:outline-none"
                          disabled={inviteSending}
                        />
                      </div>
                    </label>
                    <label className="team-invite-field">
                      <span className="team-invite-label type-label theme-muted">Email</span>
                      <div className="team-invite-input-wrap">
                        <FaIcon icon="envelope" size={12} className="team-invite-input-icon" />
                        <input
                          type="email"
                          value={inviteEmail}
                          onChange={(e) => setInviteEmail(e.target.value)}
                          placeholder="email@company.com"
                          className="team-invite-input theme-input type-input w-full focus:outline-none"
                          disabled={inviteSending}
                        />
                      </div>
                    </label>
                    <button
                      type="submit"
                      disabled={!canSendInvite}
                      className="team-invite-btn signup-continue-btn type-button text-white"
                    >
                      <FaIcon icon="paper-plane" size={12} />
                      {inviteSending ? 'Sending…' : 'Send invitation'}
                    </button>
                  </form>
                </article>

                {teamMembers.length === 0 ? (
                  <div className="team-empty">
                    <span className="team-empty-icon" aria-hidden="true">
                      <FaIcon icon="users" size={22} />
                    </span>
                    <p className="team-empty-title theme-heading">No team members yet</p>
                  </div>
                ) : (
                  <div className="team-members-block">
                    <h3 className="team-members-title theme-heading">Members</h3>
                    <div className="team-table-wrap">
                      <table className="team-table">
                      <thead>
                        <tr>
                          <th scope="col">Member</th>
                          <th scope="col">Status</th>
                          <th scope="col">Assigned inbox</th>
                          <th scope="col"><span className="sr-only">Actions</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {teamMembers.map((member) => {
                          const status = member.inviteStatus || 'accepted'
                          const isAdmin = member.role === 'Admin'
                          const canAssign = status === 'accepted' && gmailConnections.length > 0
                          const assignedInbox = gmailConnections.find((c) => c.id === member.assignedInboxId)

                          return (
                            <tr key={member.id} className={status === 'suspended' ? 'team-row-suspended' : ''}>
                              <td>
                                <div className="team-member-cell">
                                  <span className="team-member-avatar">{getInitials(member.name)}</span>
                                  <div className="min-w-0">
                                    <p className="team-member-name theme-heading truncate">{member.name}</p>
                                    <p className="team-member-email type-caption theme-muted truncate">{member.email}</p>
                                  </div>
                                  {isAdmin && <span className="team-role-tag">Admin</span>}
                                </div>
                              </td>
                              <td>
                                <span className={`team-status team-status--${status}`}>
                                  {status === 'pending' && 'Pending'}
                                  {status === 'accepted' && 'Accepted'}
                                  {status === 'suspended' && 'Suspended'}
                                </span>
                              </td>
                              <td>
                                {canAssign ? (
                                  <select
                                    value={member.assignedInboxId ?? ''}
                                    onChange={(e) => {
                                      const val = e.target.value
                                      onAssignTeamInbox(member.id, val || null)
                                    }}
                                    className="team-inbox-select theme-input type-input rounded-lg px-2 py-1.5"
                                    aria-label={`Assign inbox for ${member.name}`}
                                  >
                                    <option value="">None</option>
                                    {gmailConnections.map((conn) => (
                                      <option key={conn.id} value={conn.id}>{conn.email}</option>
                                    ))}
                                  </select>
                                ) : (
                                  <span className="team-inbox-placeholder type-caption theme-muted">
                                    {assignedInbox ? assignedInbox.email : '—'}
                                  </span>
                                )}
                              </td>
                              <td>
                                {!isAdmin && (
                                  <div className="team-row-actions">
                                    {status === 'accepted' && (
                                      <button
                                        type="button"
                                        className="team-action-btn"
                                        onClick={() => onSuspendTeamMember(member.id)}
                                        aria-label={`Suspend ${member.name}`}
                                        title="Suspend"
                                      >
                                        <FaIcon icon="pause" size={12} />
                                      </button>
                                    )}
                                    {status === 'suspended' && (
                                      <button
                                        type="button"
                                        className="team-action-btn"
                                        onClick={() => onSuspendTeamMember(member.id)}
                                        aria-label={`Reactivate ${member.name}`}
                                        title="Reactivate"
                                      >
                                        <FaIcon icon="play" size={12} />
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      className="team-action-btn team-action-btn--danger"
                                      onClick={() => onDeleteTeamMember(member.id)}
                                      aria-label={`Remove ${member.name}`}
                                      title="Delete"
                                    >
                                      <FaIcon icon="trash" size={12} />
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

const EMAIL_UNIT_PRICE_INR = 300

const PLAN_OPTIONS = [
  {
    id: 'starter',
    name: 'Starter',
    emails: 1,
    priceInr: EMAIL_UNIT_PRICE_INR * 1,
    features: [
      { icon: 'envelope', text: '1 Gmail connection' },
      { icon: 'folder', text: '1 Drive connection' },
      { icon: 'plug', text: '1 API connection' },
      { icon: 'database', text: '500 AI credits' },
      { icon: 'briefcase', text: '10 jobs' },
    ],
  },
  {
    id: 'growth',
    name: 'Growth',
    emails: 3,
    priceInr: EMAIL_UNIT_PRICE_INR * 3,
    features: [
      { icon: 'envelope', text: '3 Gmail connections' },
      { icon: 'folder', text: '1 Drive connection' },
      { icon: 'plug', text: '1 API connection' },
      { icon: 'database', text: '1,500 AI credits' },
      { icon: 'briefcase', text: '30 jobs' },
    ],
  },
  {
    id: 'scale',
    name: 'Scale',
    emails: 5,
    priceInr: EMAIL_UNIT_PRICE_INR * 5,
    features: [
      { icon: 'envelope', text: '5 Gmail connections' },
      { icon: 'folder', text: '1 Drive connection' },
      { icon: 'plug', text: '1 API connection' },
      { icon: 'database', text: '2,500 AI credits' },
      { icon: 'briefcase', text: '50 jobs' },
    ],
  },
]

function formatPlanPrice(amount) {
  return `₹${amount.toLocaleString('en-IN')}`
}

function getCheckoutPlanDetails(selectedPlanId, plansList = PLAN_OPTIONS) {
  const plan = plansList.find((item) => item.id === selectedPlanId)
  if (!plan) return null

  return {
    planName: plan.name,
    emails: plan.emails,
    amountInr: plan.priceInr,
  }
}

const EMPTY_SIGNUP = {
  owner_name: '',
  email: '',
  organization: '',
  industry: '',
  location: '',
  employee_count: '',
}

const SIGNUP_STEPS = [
  {
    key: 'owner_name',
    title: 'Account owner',
    question: 'Who will lead hiring on this account?',
    hint: 'Full name of the primary contact',
    icon: 'user-tie',
    placeholder: 'e.g. Abhay Kumar',
    inputType: 'text',
  },
  {
    key: 'email',
    title: 'Work email',
    question: 'Where should we send onboarding updates?',
    hint: 'Use your company email address',
    icon: 'envelope',
    placeholder: 'you@company.com',
    inputType: 'email',
  },
  {
    key: 'organization',
    title: 'Organization',
    question: 'What company are you hiring for?',
    hint: 'Legal or brand name',
    icon: 'building',
    placeholder: 'TalentHive Agency',
    inputType: 'text',
  },
  {
    key: 'industry',
    title: 'Industry',
    question: 'Which sector best describes you?',
    hint: 'Pick the closest match',
    icon: 'briefcase',
    options: ['IT & Software', 'Staffing & RPO', 'BFSI', 'Healthcare', 'Manufacturing', 'Other'],
  },
  {
    key: 'location',
    title: 'Location',
    question: 'Where is your team based?',
    hint: 'City and country',
    icon: 'location-dot',
    placeholder: 'Bangalore, India',
    inputType: 'text',
  },
  {
    key: 'employee_count',
    title: 'Team size',
    question: 'How many employees does your org have?',
    hint: 'Approximate headcount',
    icon: 'users',
    options: ['1–10', '11–50', '51–200', '201–500', '500+'],
  },
]

function SignUpWizard({ theme, onThemeChange, onBack, onError }) {
  const [step, setStep] = useState(0)
  const [data, setData] = useState(EMPTY_SIGNUP)
  const [registered, setRegistered] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const current = SIGNUP_STEPS[step]
  const value = data[current?.key] ?? ''

  const canContinue = current?.options
    ? Boolean(value)
    : String(value).trim().length > 0

  const updateField = (key, nextValue) => {
    setData((prev) => ({ ...prev, [key]: nextValue }))
  }

  const handleContinue = async () => {
    if (!canContinue || submitting) return
    if (step < SIGNUP_STEPS.length - 1) {
      setStep((s) => s + 1)
      return
    }

    setSubmitting(true)
    try {
      await signup({
        owner_name: data.owner_name.trim(),
        email: data.email.trim(),
        organization: data.organization.trim(),
        industry: data.industry.trim(),
        location: data.location.trim(),
        employee_count: data.employee_count.trim(),
      })
      setRegistered(true)
    } catch (err) {
      onError?.(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen relative signin-bg overflow-hidden flex items-center justify-center px-4 py-10">
      <div className="signin-mesh" aria-hidden="true">
        <div className="signin-blob signin-blob-1" />
        <div className="signin-blob signin-blob-2" />
        <div className="signin-blob signin-blob-3" />
        <div className="signin-blob signin-blob-4" />
        <div className="signin-blob signin-blob-5" />
      </div>

      <div className="absolute top-6 left-6 right-6 z-20 flex items-center justify-between">
        {!registered ? (
          <button
            type="button"
            onClick={onBack}
            className="signup-back-btn type-caption theme-muted flex items-center gap-1.5"
          >
            <FaIcon icon="arrow-left" size={12} /> Back to sign in
          </button>
        ) : (
          <span />
        )}
        <ThemeSwitcher theme={theme} onChange={onThemeChange} />
      </div>

      <div className="signup-wizard relative z-10 w-full max-w-3xl">
        {registered ? (
          <div className="signup-wizard-card signup-success-card rounded-3xl p-8 md:p-12 text-center">
            <div className="signup-success-badge mx-auto mb-6">
              <FaIcon icon="envelope-circle-check" size={34} />
            </div>
            <h2 className="type-section theme-heading">Registration Successful</h2>
            <p className="type-body theme-heading font-semibold mt-3 max-w-md mx-auto leading-relaxed">
              Your account is ready.
            </p>
            <p className="type-body theme-muted mt-3 max-w-md mx-auto leading-relaxed">
              Check your email for your login credentials, then sign in to continue.
            </p>
            <button
              type="button"
              onClick={onBack}
              className="signup-continue-btn type-button text-white rounded-xl py-3.5 px-8 w-full max-w-xs mx-auto mt-8"
            >
              Back to sign in
            </button>
          </div>
        ) : (
          <div className="signup-wizard-card rounded-3xl p-8 md:p-10">
            <div className="mb-8">
              <Logo className="text-lg" />
            </div>

            <div className="grid md:grid-cols-[7rem_1fr] gap-6 md:gap-8 items-start">
              <div className="signup-step-rail hidden md:flex flex-col items-center gap-2">
                {SIGNUP_STEPS.map((item, index) => (
                  <div key={item.key} className="signup-step-rail-item flex flex-col items-center">
                    <div
                      className={`signup-step-node ${index < step ? 'signup-step-node-done' : ''} ${index === step ? 'signup-step-node-active' : ''}`}
                    >
                      {index < step ? <FaIcon icon="check" size={12} /> : <FaIcon icon={item.icon} size={14} />}
                    </div>
                    {index < SIGNUP_STEPS.length - 1 && (
                      <div className={`signup-step-connector ${index < step ? 'signup-step-connector-done' : ''}`} />
                    )}
                  </div>
                ))}
              </div>

              <div className="signup-step-panel">
                <div className="signup-step-icon-wrap mb-5">
                  <FaIcon icon={current.icon} size={26} className="text-ez-accent" />
                </div>
                <p className="type-label theme-muted uppercase tracking-wide">{current.title}</p>
                <h2 className="type-section theme-heading mt-1">{current.question}</h2>
                <p className="type-caption theme-muted mt-2 mb-6">{current.hint}</p>

                {current.options ? (
                  <div className="signup-chip-grid">
                    {current.options.map((option) => {
                      const selected = value === option
                      return (
                        <button
                          key={option}
                          type="button"
                          onClick={() => updateField(current.key, option)}
                          className={`signup-chip ${selected ? 'signup-chip-selected' : ''}`}
                        >
                          {option}
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <input
                    type={current.inputType}
                    value={value}
                    onChange={(e) => updateField(current.key, e.target.value)}
                    placeholder={current.placeholder}
                    className="signup-field-input signin-input theme-input type-input rounded-2xl px-5 py-4 w-full focus:outline-none"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && canContinue) handleContinue()
                    }}
                  />
                )}

                <div className="flex items-center justify-between gap-4 mt-8">
                  <button
                    type="button"
                    onClick={() => setStep((s) => Math.max(0, s - 1))}
                    disabled={step === 0 || submitting}
                    className="signup-prev-btn type-button theme-muted disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={handleContinue}
                    disabled={!canContinue || submitting}
                    className="signup-continue-btn type-button text-white rounded-xl py-3 px-8 disabled:opacity-45"
                  >
                    {submitting
                      ? 'Creating account…'
                      : step === SIGNUP_STEPS.length - 1
                        ? 'Complete registration'
                        : 'Continue'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function UpgradePlanModal({
  open,
  selectedPlanId,
  upgradePlans = [],
  currentPlanId = '',
  isOnDemoPlan = false,
  onSelectPlan,
  onPaymentVerified,
  onError,
  onClose,
}) {
  const [checkoutLoading, setCheckoutLoading] = useState(false)
  const [verifyingPayment, setVerifyingPayment] = useState(false)

  if (!open) return null

  const presetPlans = upgradePlans.length > 0
    ? upgradePlans.map((plan) => planToUpgradeOption(plan))
    : PLAN_OPTIONS.filter((plan) => plan.name.toLowerCase() !== 'demo')
  const checkoutDetails = getCheckoutPlanDetails(selectedPlanId, presetPlans)
  const isCurrentPaidPlan = !isOnDemoPlan && !!currentPlanId && selectedPlanId === currentPlanId
  const buyDisabled = checkoutLoading || verifyingPayment

  const handleBuy = async () => {
    if (isCurrentPaidPlan) {
      onClose()
      return
    }

    if (!selectedPlanId) return

    setCheckoutLoading(true)
    try {
      const order = await createBillingOrder(selectedPlanId)
      setCheckoutLoading(false)

      await openRazorpayCheckout(
        order,
        async (razorpayResponse) => {
          setVerifyingPayment(true)
          try {
            await verifyBillingPayment(razorpayResponse)
            onClose()
            onPaymentVerified?.({ planName: order.plan_name })
          } catch (err) {
            if (err instanceof Error && err.message === 'PAYMENT_VERIFY_FAILED') {
              onError?.(PAYMENT_VERIFY_FAILED_MESSAGE)
            } else {
              onError?.(err instanceof Error ? err.message : 'Something went wrong')
            }
          } finally {
            setVerifyingPayment(false)
          }
        },
      )
    } catch (err) {
      onError?.(err instanceof Error ? err.message : 'Could not start checkout')
      setCheckoutLoading(false)
    }
  }

  const buyLabel = checkoutDetails
    ? `Buy · ${formatPlanPrice(checkoutDetails.amountInr)}/mo`
    : 'Buy plan'

  return (
    <div
      className="upgrade-plan-overlay fixed inset-0 z-50 flex items-center justify-center p-4 md:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="upgrade-plan-title"
    >
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close" onClick={onClose} />
      <div className="upgrade-plan-modal relative w-full max-w-3xl rounded-3xl p-6 md:p-8">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="min-w-0 flex-1">
            <span className="modern-eyebrow">Billing</span>
            <h2 id="upgrade-plan-title" className="type-section theme-heading mt-1">Choose your plan</h2>
            {isOnDemoPlan && (
              <p className="type-caption theme-muted mt-1.5">
                You&apos;re on the Demo plan. Upgrade anytime, or continue with Demo for now.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="resume-viewer-close flex-shrink-0"
            aria-label="Close"
          >
            <FaIcon icon="xmark" size={14} />
          </button>
        </div>

        <div className="upgrade-plan-grid grid grid-cols-1 md:grid-cols-3 gap-4">
          {presetPlans.map((plan) => {
            const selected = selectedPlanId === plan.id
            const isPlanCurrent = !isOnDemoPlan && plan.id === currentPlanId
            return (
              <button
                key={plan.id}
                type="button"
                onClick={() => onSelectPlan(plan.id)}
                className={`upgrade-plan-card text-left rounded-2xl p-5 border transition-all ${
                  selected ? 'upgrade-plan-card-selected' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-3">
                  <span className={`upgrade-plan-badge ${isPlanCurrent ? 'upgrade-plan-badge-current' : ''}`}>
                    {plan.name}
                  </span>
                  {selected && (
                    <span className="upgrade-plan-check" aria-hidden="true">
                      <FaIcon icon="circle-check" size={16} />
                    </span>
                  )}
                </div>
                <div className="mt-1">
                  <p className="upgrade-plan-price type-subheading theme-heading">
                    {formatPlanPrice(plan.priceInr)}
                    <span className="upgrade-plan-price-period type-caption theme-muted"> / month</span>
                  </p>
                </div>
                <ul className="upgrade-plan-features mt-4 space-y-2.5">
                  {plan.features.map((feature) => (
                    <li key={feature.text} className="type-caption theme-muted flex items-start gap-2">
                      <FaIcon icon={feature.icon} size={12} className="mt-0.5 flex-shrink-0 text-ez-accent" />
                      <span>{feature.text}</span>
                    </li>
                  ))}
                </ul>
              </button>
            )
          })}
        </div>

        <div className="mt-6 flex items-center justify-between gap-3 flex-wrap">
          {isOnDemoPlan ? (
            <button
              type="button"
              onClick={onClose}
              className="type-button theme-muted px-4 py-2.5 rounded-xl"
            >
              Continue with Demo plan
            </button>
          ) : (
            <span aria-hidden="true" />
          )}
          <div className="flex items-center gap-3 ml-auto">
            {!isOnDemoPlan && (
              <button type="button" onClick={onClose} className="type-button theme-muted px-4 py-2.5 rounded-xl">
                Cancel
              </button>
            )}
            <button
              type="button"
              onClick={handleBuy}
              disabled={buyDisabled}
              className="type-button bg-[#2d6a84] hover:bg-[#235470] text-white rounded-xl py-2.5 px-6 transition-colors disabled:opacity-60"
            >
              {verifyingPayment
                ? 'Verifying payment…'
                : checkoutLoading
                  ? 'Starting checkout…'
                  : isCurrentPaidPlan
                    ? 'Keep current plan'
                    : buyLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function RequirementStatusModal({ open, isActive, jobTitle, onClose }) {
  if (!open) return null

  const statusLabel = isActive ? 'active' : 'inactive'

  return (
    <div className="scan-modal-overlay fixed inset-0 z-50 flex items-center justify-center p-6" role="dialog" aria-modal="true" aria-labelledby="requirement-status-title">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close" onClick={onClose} />
      <div className="scan-modal relative w-full max-w-md rounded-3xl p-8">
        <div className="flex flex-col items-center text-center mb-5">
          <div className="setup-icon-wrap w-14 h-14 rounded-2xl flex items-center justify-center mb-4">
            <FaIcon icon={isActive ? 'circle-check' : 'circle-pause'} size={26} />
          </div>
          <h2 id="requirement-status-title" className="type-section theme-heading">
            Requirement {isActive ? 'Activated' : 'Deactivated'}
          </h2>
          <p className="type-body theme-muted mt-3 leading-relaxed">
            By making this requirement <span className="font-semibold theme-heading">{statusLabel}</span>, the scan is getting pushed for{' '}
            <span className="font-semibold theme-heading">{jobTitle}</span>.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="type-button bg-[#2d6a84] hover:bg-[#235470] text-white rounded-xl py-3 px-8 w-full transition-colors"
        >
          Got it
        </button>
      </div>
    </div>
  )
}

function RequirementActiveToggle({ active, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      aria-label={active ? 'Set requirement inactive' : 'Set requirement active'}
      onClick={() => onChange(!active)}
      className={`requirement-toggle relative w-11 h-6 rounded-full transition-all flex-shrink-0 ${active ? 'requirement-toggle-on' : ''}`}
    >
      <span className="requirement-toggle-thumb absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform" />
    </button>
  )
}

function FaIcon({ icon, size = 16, className = '' }) {
  return (
    <i
      className={`fa-solid fa-${icon} inline-flex items-center justify-center shrink-0 ${className}`}
      style={{ fontSize: size, width: '1em', height: '1em' }}
      aria-hidden="true"
    />
  )
}

function FaBrand({ icon, size = 14, className = '' }) {
  return (
    <i
      className={`fa-brands fa-${icon} inline-flex items-center justify-center shrink-0 ${className}`}
      style={{ fontSize: size, width: '1em', height: '1em' }}
      aria-hidden="true"
    />
  )
}

const candidateData = [
  { id: 1, name: 'Arjun Sharma', exp: '5 yrs', role: 'Senior Frontend Dev', score: 82, location: 'Bangalore', email: 'arjun.s@gmail.com', phone: '+91 98765 43210', stage: 'New', edu: 'B.Tech CS — IIT Delhi, 2019', primary: ['React.js', 'TypeScript', 'Node.js', 'AWS'], secondary: ['PostgreSQL', 'GraphQL', 'Docker'], breakdown: { skills: 38, exp: 27, edu: 12, profile: 9, recency: 5 } },
  { id: 2, name: 'Sneha Patel', exp: '4 yrs', role: 'React Developer', score: 76, location: 'Pune', email: 'sneha.p@gmail.com', phone: '+91 87654 32109', stage: 'Shortlisted', edu: 'B.E. IT — BITS Pilani, 2020', primary: ['React', 'TypeScript', 'REST APIs'], secondary: ['PostgreSQL', 'Docker'], breakdown: { skills: 33, exp: 25, edu: 12, profile: 6, recency: 5 } },
  { id: 3, name: 'Rahul Verma', exp: '6 yrs', role: 'Full Stack Developer', score: 74, location: 'Hyderabad', email: 'rahul.v@gmail.com', phone: '+91 76543 21098', stage: 'In Progress', edu: 'M.Tech — NIT Trichy, 2018', primary: ['React', 'Node.js', 'PostgreSQL'], secondary: ['AWS', 'TypeScript'], breakdown: { skills: 30, exp: 26, edu: 13, profile: 5, recency: 0 } },
  { id: 4, name: 'Priya Nair', exp: '5 yrs', role: 'Frontend Engineer', score: 71, location: 'Chennai', email: 'priya.n@yahoo.com', phone: '+91 65432 10987', stage: 'New', edu: 'B.Tech CS — VIT, 2019', primary: ['React', 'JavaScript', 'TypeScript'], secondary: ['Next.js', 'Tailwind'], breakdown: { skills: 29, exp: 25, edu: 10, profile: 7, recency: 0 } },
  { id: 5, name: 'Karan Mehta', exp: '3 yrs', role: 'React Developer', score: 58, location: 'Mumbai', email: 'karan.m@gmail.com', phone: '+91 54321 09876', stage: 'Rejected', edu: 'BCA — Pune University, 2021', primary: ['React', 'JavaScript'], secondary: ['CSS', 'Redux'], breakdown: { skills: 22, exp: 20, edu: 8, profile: 8, recency: 0 } },
  { id: 6, name: 'Divya Reddy', exp: '2 yrs', role: 'Junior Frontend Dev', score: 44, location: 'Hyderabad', email: 'divya.r@gmail.com', phone: '+91 43210 98765', stage: 'New', edu: 'B.Sc IT — Osmania, 2022', primary: ['React', 'HTML/CSS'], secondary: ['JavaScript'], breakdown: { skills: 15, exp: 14, edu: 8, profile: 7, recency: 0 } },
  { id: 7, name: 'Amit Singh', exp: '1 yr', role: 'Trainee Developer', score: 31, location: 'Delhi', email: 'amit.s@gmail.com', phone: '+91 32109 87654', stage: 'New', edu: 'BCA — DU, 2023', primary: ['React', 'HTML'], secondary: [], breakdown: { skills: 10, exp: 8, edu: 8, profile: 5, recency: 0 } },
]

const EXTRACTED_JOB = {
  title: 'Senior React Developer',
  expMin: '4',
  expMax: '6',
  education: 'B.Tech CS or equivalent',
  location: 'Bangalore',
  primarySkillsText: 'React.js, TypeScript, Node.js',
  secondarySkillsText: 'PostgreSQL, AWS',
}

function NayraAssistant() {
  return (
    <span className="nayra-assistant mascot-assistant" aria-hidden="true">
      <svg className="nayra-assistant-svg" viewBox="0 0 100 145" fill="none" xmlns="http://www.w3.org/2000/svg">
        <ellipse className="nayra-shadow" cx="50" cy="138" rx="26" ry="4.5" />

        <path
          className="nayra-hair-back"
          d="M22 42c0-16 56-16 56 0v44c0 12-12 22-28 22s-28-10-28-22V42z"
        />

        <path
          className="nayra-body"
          d="M30 96C22 97 17 102 16 110C14 122 17 132 24 135Q50 138 76 135C83 132 86 122 84 110C83 102 78 97 70 96Z"
        />
        <path
          className="nayra-body-shadow"
          d="M30 96C22 97 17 102 16 110C14 122 17 132 24 135V96Z"
        />

        <path
          className="nayra-shoulder-seam"
          d="M36 100C30 108 26 118 24 126"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
        <path
          className="nayra-shoulder-seam"
          d="M64 100C70 108 74 118 76 126"
          strokeWidth="1.3"
          strokeLinecap="round"
        />

        <path className="nayra-hair-side" d="M28 48c-4 8-4 26 0 30" strokeWidth="7" strokeLinecap="round" />
        <path className="nayra-hair-side" d="M72 48c4 8 4 26 0 30" strokeWidth="7" strokeLinecap="round" />

        <rect className="nayra-neck" x="44" y="78" width="12" height="10" />
        <path className="nayra-neck-shadow" d="M44 80H46.5V90H44Z" />

        <rect className="nayra-collar" x="33" y="88" width="34" height="9" rx="2.5" />

        <ellipse className="nayra-face" cx="50" cy="54" rx="20" ry="24" />

        <path
          className="nayra-bangs"
          d="M30 36c0-11 40-11 40 0v14c-4 3-9 4-20 4s-16-1-20-4V36z"
        />

        <path
          className="nayra-headset-band"
          d="M18 53c3-20 62-20 64 0"
          strokeWidth="3.8"
          strokeLinecap="round"
        />

        <ellipse className="nayra-headset-cup" cx="19" cy="55" rx="9.5" ry="11.5" />
        <ellipse className="nayra-headset-cup" cx="81" cy="55" rx="9.5" ry="11.5" />
        <ellipse className="nayra-headset-cup-inner" cx="19" cy="55" rx="5.8" ry="7.2" />
        <ellipse className="nayra-headset-cup-inner" cx="81" cy="55" rx="5.8" ry="7.2" />

        <ellipse className="nayra-eye-white" cx="40" cy="55" rx="6" ry="7" />
        <ellipse className="nayra-eye-white" cx="60" cy="55" rx="6" ry="7" />
        <ellipse className="nayra-eye-iris nayra-eye-left" cx="40" cy="56" rx="4" ry="5" />
        <ellipse className="nayra-eye-iris nayra-eye-right" cx="60" cy="56" rx="4" ry="5" />
        <circle className="nayra-eye-pupil" cx="40.6" cy="56.5" r="1.5" />
        <circle className="nayra-eye-pupil" cx="60.6" cy="56.5" r="1.5" />
        <circle className="nayra-eye-shine" cx="38.5" cy="54" r="1.4" />
        <circle className="nayra-eye-shine" cx="58.5" cy="54" r="1.4" />

        <path className="nayra-lash" d="M33 49l3 2M36 47l3 1" strokeWidth="1.2" strokeLinecap="round" />
        <path className="nayra-lash" d="M67 49l-3 2M64 47l-3 1" strokeWidth="1.2" strokeLinecap="round" />

        <path className="nayra-brow" d="M33 46c4-2 9-2 13 0" strokeWidth="1.7" strokeLinecap="round" />
        <path className="nayra-brow" d="M54 46c4-2 9-2 13 0" strokeWidth="1.7" strokeLinecap="round" />

        <path className="nayra-nose" d="M50 59v4.5" strokeWidth="1.4" strokeLinecap="round" />
        <path className="nayra-lips" d="M45.5 65.5c2.2 1.6 6.8 1.6 9 0" strokeWidth="1.9" strokeLinecap="round" />

        <path
          className="nayra-headset-mic"
          d="M81 66c5 7 3 16-5 18"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <circle className="nayra-headset-mic-tip" cx="74" cy="85" r="2.4" />
      </svg>
    </span>
  )
}

const DASHBOARD_TODOS_STORAGE_KEY = 'ez-dashboard-todos'

function loadStoredDashboardTodos() {
  try {
    const raw = localStorage.getItem(DASHBOARD_TODOS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function DashboardSideRail({ pendingCount, todosOpen, onOpenTodos, onOpenScoring }) {
  if (todosOpen) return null

  const todoLabelChars = ['T', 'O', 'D', 'O']
  const scoringLabelChars = ['S', 'C', 'O', 'R', 'E']

  return (
    <div className="dashboard-side-rail" aria-label="Dashboard shortcuts">
      <button
        type="button"
        onClick={onOpenScoring}
        className="dashboard-notes-tab dashboard-side-tab--scoring"
        aria-label="Set scoring weights"
      >
        <span className="dashboard-notes-tab-icon" aria-hidden="true">
          <FaIcon icon="sliders" size={16} />
        </span>
        <span className="dashboard-notes-tab-label" aria-hidden="true">
          {scoringLabelChars.map((char, index) => (
            <span key={`score-${char}-${index}`} className="dashboard-notes-tab-letter">
              {char}
            </span>
          ))}
        </span>
      </button>

      <button
        type="button"
        onClick={onOpenTodos}
        className="dashboard-notes-tab dashboard-side-tab--todo"
        aria-label="Open To-Do list"
      >
        <span className="dashboard-notes-tab-icon" aria-hidden="true">
          <FaIcon icon="list-check" size={16} />
        </span>
        <span className="dashboard-notes-tab-label" aria-hidden="true">
          {todoLabelChars.map((char, index) => (
            <span key={`todo-${char}-${index}`} className="dashboard-notes-tab-letter">
              {char}
            </span>
          ))}
        </span>
        {pendingCount > 0 && (
          <span className="dashboard-notes-tab-count">{pendingCount}</span>
        )}
      </button>
    </div>
  )
}

function DashboardTodosPanel({ open, todos, onTodosChange, onClose }) {
  const [newTodoText, setNewTodoText] = useState('')

  useEffect(() => {
    if (!open) return undefined

    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', onKeyDown)
    lockPageScroll()

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      unlockPageScroll()
    }
  }, [open, onClose])

  const pendingTodos = todos.filter((t) => !t.done)
  const completedTodos = todos.filter((t) => t.done)

  const handleAddTodo = (event) => {
    event.preventDefault()
    const text = newTodoText.trim()
    if (!text) return
    const now = Date.now()
    onTodosChange([
      { id: `todo-${now}`, text, done: false, createdAt: now },
      ...todos,
    ])
    setNewTodoText('')
  }

  const toggleTodo = (id) => {
    onTodosChange(
      todos.map((t) => (t.id === id ? { ...t, done: !t.done, updatedAt: Date.now() } : t))
    )
  }

  const deleteTodo = (id) => {
    onTodosChange(todos.filter((t) => t.id !== id))
  }

  const clearCompletedTodos = () => {
    onTodosChange(todos.filter((t) => !t.done))
  }

  if (!open) return null

  return (
    <div className="my-notes-root">
      <button
        type="button"
        className="my-notes-backdrop"
        onClick={onClose}
        aria-label="Close to-do panel"
      />
      <aside className="my-notes-panel" role="dialog" aria-modal="true" aria-labelledby="dashboard-todos-title">
        <div className="my-notes-content">
          <div className="my-notes-toolbar">
            <div className="my-notes-toolbar-top">
              <div className="my-notes-heading">
                <span className="my-notes-badge" aria-hidden="true">
                  <FaIcon icon="list-check" size={18} />
                </span>
                <div>
                  <h2 id="dashboard-todos-title" className="type-subheading font-semibold theme-heading">To-Do</h2>
                  <p className="type-caption theme-muted mt-1">Track follow-ups, interviews, and hiring tasks.</p>
                </div>
              </div>
              <button type="button" onClick={onClose} className="my-notes-close" aria-label="Close">
                <FaIcon icon="xmark" size={16} />
              </button>
            </div>
          </div>

          <div className="my-notes-body my-notes-body-todos">
            <div className="my-notes-form my-notes-todos-panel">
              <div className="my-notes-form-head">
                <span className="type-label theme-muted">TO-DO LIST</span>
                <div className="my-notes-form-head-meta">
                  <span className="type-caption theme-muted">{pendingTodos.length} open</span>
                  {completedTodos.length > 0 && (
                    <button type="button" onClick={clearCompletedTodos} className="my-notes-clear-done type-caption">
                      Clear completed
                    </button>
                  )}
                </div>
              </div>

              <form className="my-notes-todo-add" onSubmit={handleAddTodo}>
                <div className="my-notes-todo-add-field">
                  <FaIcon icon="circle-plus" size={15} className="my-notes-todo-add-icon" />
                  <input
                    type="text"
                    value={newTodoText}
                    onChange={(e) => setNewTodoText(e.target.value)}
                    placeholder="Add a task — e.g. Schedule interview with Arjun"
                    className="my-notes-todo-input type-body theme-heading"
                  />
                </div>
                <button type="submit" disabled={!newTodoText.trim()} className="my-notes-todo-add-btn">
                  <FaIcon icon="plus" size={13} />
                  Add
                </button>
              </form>

              {todos.length === 0 ? (
                <div className="my-notes-todo-empty">
                  <span className="my-notes-todo-empty-icon" aria-hidden="true">
                    <FaIcon icon="list-check" size={22} />
                  </span>
                  <p className="type-body theme-heading mt-3">Your hiring checklist starts here</p>
                  <p className="type-caption theme-muted mt-1">Track follow-ups, interview slots, and offer steps.</p>
                </div>
              ) : (
                <ul className="my-notes-todo-list">
                  {todos.map((todo) => (
                    <li key={todo.id} className={`my-notes-todo-item ${todo.done ? 'my-notes-todo-item-done' : ''}`}>
                      <button
                        type="button"
                        onClick={() => toggleTodo(todo.id)}
                        className={`my-notes-todo-check ${todo.done ? 'my-notes-todo-check-done' : ''}`}
                        aria-label={todo.done ? `Mark "${todo.text}" as incomplete` : `Mark "${todo.text}" as complete`}
                        aria-pressed={todo.done}
                      >
                        {todo.done && <FaIcon icon="check" size={11} />}
                      </button>
                      <span className="my-notes-todo-text type-body theme-heading">{todo.text}</span>
                      <button
                        type="button"
                        onClick={() => deleteTodo(todo.id)}
                        className="my-notes-todo-delete"
                        aria-label={`Delete "${todo.text}"`}
                      >
                        <FaIcon icon="xmark" size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </aside>
    </div>
  )
}

function DashboardMascotDock({ onSearch, onWhatsApp, onSettings }) {
  return (
    <div className="dashboard-mascot-dock" aria-label="Assistant shortcuts">
      <button
        type="button"
        onClick={onSettings}
        className="dashboard-mascot-fab dashboard-dock-icon-btn"
        aria-label="Open settings"
      >
        <span className="dashboard-dock-icon dashboard-dock-icon--settings">
          <FaIcon icon="gear" size={20} />
        </span>
        <span className="dashboard-mascot-fab-hint">Open settings</span>
      </button>
      <button
        type="button"
        onClick={onWhatsApp}
        className="dashboard-mascot-fab dashboard-dock-icon-btn"
        aria-label="Chat on WhatsApp"
      >
        <span className="dashboard-dock-icon dashboard-dock-icon--whatsapp">
          <FaBrand icon="whatsapp" size={22} />
        </span>
        <span className="dashboard-mascot-fab-hint">Chat on WhatsApp</span>
      </button>
      <button
        type="button"
        onClick={onSearch}
        className="dashboard-mascot-fab"
        aria-label="Search with Nayra"
        style={{ '--mascot-float-delay': '0.35s' }}
      >
        <NayraAssistant />
        <span className="dashboard-mascot-fab-hint">Search with Nayra</span>
      </button>
    </div>
  )
}

function Logo({ className = '' }) {
  return (
    <span className={`brand-logo type-card-title ${className}`} aria-label="InboxHire">
      <span className="brand-logo-text">
        <span className="font-light">Inbox</span>
        <span className="font-bold">Hire</span>
      </span>
    </span>
  )
}

function ThemeSwitcher({ theme, onChange }) {
  const options = [
    { value: 'light', icon: 'lightbulb', label: 'Light' },
    { value: 'dark', icon: 'moon', label: 'Dark' },
  ]

  return (
    <div className="theme-switcher flex items-center rounded-xl p-0.5 gap-0.5">
      {options.map(({ value, icon, label }) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          className={`theme-switcher-btn w-8 h-8 rounded-lg flex items-center justify-center ${
            theme === value ? 'theme-switcher-btn-active' : ''
          }`}
          aria-label={`${label} background`}
          title={`${label} background`}
        >
          <FaIcon icon={icon} size={14} />
        </button>
      ))}
    </div>
  )
}

function getInitials(name) {
  if (!name || typeof name !== 'string') return '?'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return parts.map((part) => part[0]).join('').toUpperCase().slice(0, 2)
}

function ProfileMenu({ userName, onLogout }) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined

    const handlePointerDown = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [open])

  const displayName = userName.trim() || 'Account'
  const initials = getInitials(displayName)

  return (
    <div className="profile-menu" ref={menuRef}>
      <button
        type="button"
        className="profile-menu-trigger"
        onClick={() => setOpen((visible) => !visible)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <div className="text-right">
          <p className="type-subheading font-semibold theme-heading">TalentHive Agency</p>
          <p className="type-label theme-muted">PREMIUM PLAN</p>
        </div>
        <span className="profile-menu-avatar">{initials.slice(0, 2)}</span>
      </button>

      {open && (
        <div className="profile-menu-dropdown" role="menu">
          <p className="profile-menu-name type-caption theme-heading">{displayName}</p>
          <button
            type="button"
            role="menuitem"
            className="profile-menu-logout"
            onClick={() => {
              setOpen(false)
              onLogout()
            }}
          >
            <FaIcon icon="right-from-bracket" size={12} />
            Log out
          </button>
        </div>
      )}
    </div>
  )
}

function SignInProductDemo() {
  const flowNode = 'flow-node flex-shrink-0 rounded-xl p-3 flex flex-col items-center w-[96px]'

  const jobBoardSources = [
    { board: 'Naukri', color: 'bg-[#4338ca]', cv: 'Arjun_CV.pdf', anim: 'product-cv-1' },
    { board: 'Monster', color: 'bg-[#7c3aed]', cv: 'Sneha_CV.pdf', anim: 'product-cv-2' },
    { board: 'Indeed', color: 'bg-[#2164f3]', cv: 'Rahul_CV.pdf', anim: 'product-cv-3' },
  ]

  const connectSources = [
    { id: 'gmail', label: 'Gmail', icon: 'envelope', brand: false, iconClass: 'text-ez-accent-orange', delay: 0 },
    { id: 'drive', label: 'Drive', icon: 'google-drive', brand: true, iconClass: 'text-[#4285f4]', delay: 0.45 },
    { id: 'api', label: 'External', icon: 'plug', brand: false, iconClass: 'text-ez-accent', delay: 0.9 },
  ]

  return (
    <div className="product-demo mt-10 w-full animate-signin-card-left">
      <div className="relative min-h-[118px] h-[128px] w-full">
        {/* Scene 1 — CVs from job boards → inbox */}
        <div className="product-scene product-scene-1">
          <p className="product-step-label mb-3">Step 1 · CVs from job boards to your inbox</p>
          <div className="flex items-center w-full gap-5">
            <div className="flex flex-[2] justify-between gap-4 min-w-0">
              {jobBoardSources.map((src) => (
                <div key={src.board} className="flex flex-col items-center gap-1.5 flex-1 min-w-0">
                  <span className={`product-board-badge text-[8px] font-bold uppercase tracking-wide px-2.5 py-0.5 rounded-full text-white ${src.color}`}>
                    {src.board}
                  </span>
                  <div className={`product-cv ${src.anim} flex items-center gap-1 rounded-lg px-2 py-1`}>
                    <FaIcon icon="file-lines" size={11} className="text-ez-accent-orange flex-shrink-0" />
                    <span className="text-[9px] font-medium theme-heading truncate">{src.cv}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="product-stream flex-1 relative h-12 min-w-[120px] max-w-[168px]">
              <div className="product-stream-track" aria-hidden="true">
                <div className="product-stream-beam" />
                <div className="product-stream-shimmer" />
              </div>
              {jobBoardSources.map((src, index) => (
                <div
                  key={src.cv}
                  className={`product-stream-packet product-stream-packet-${index + 1}`}
                  aria-hidden="true"
                >
                  <FaIcon icon="file-lines" size={10} className="text-ez-accent-orange" />
                </div>
              ))}
              <div className="product-stream-destination" aria-hidden="true">
                <span className="product-stream-ring" />
                <FaIcon icon="chevron-right" size={11} className="text-ez-accent relative z-[1]" />
              </div>
            </div>
            <div className={flowNode}>
              <FaIcon icon="inbox" size={20} className="text-ez-accent" />
              <span className="text-[10px] font-semibold theme-heading mt-1">Gmail Inbox</span>
            </div>
          </div>
        </div>

        {/* Scene 2 — Connect Gmail, Drive & External API */}
        <div className="product-scene product-scene-2">
          <p className="product-step-label mb-2.5">Step 2 · Connect via InboxHire</p>
          <div className="product-connect-inline flex items-center w-full gap-2">
            <div className="product-connect-chips flex flex-[1.4] gap-1.5 min-w-0">
              {connectSources.map((source) => (
                <div
                  key={source.id}
                  className={`product-connect-chip product-connect-chip-${source.id}`}
                  style={{ '--connect-delay': `${source.delay}s` }}
                >
                  <div className={`product-connect-chip-icon product-connect-chip-icon-${source.id}`}>
                    {source.brand ? (
                      <FaBrand icon={source.icon} size={13} className={source.iconClass} />
                    ) : (
                      <FaIcon icon={source.icon} size={13} className={source.iconClass} />
                    )}
                  </div>
                  <span className="product-connect-chip-label">{source.label}</span>
                </div>
              ))}
            </div>

            <div className="product-connect-merge flex-1 relative h-11 min-w-[84px] max-w-[132px]">
              <div className="product-connect-merge-track" aria-hidden="true">
                <div className="product-connect-merge-beam" />
                <div className="product-connect-merge-shimmer" />
              </div>
              {connectSources.map((source, index) => (
                <span
                  key={source.id}
                  className={`product-connect-merge-spark product-connect-merge-spark-${index + 1}`}
                  style={{ '--connect-delay': `${source.delay}s` }}
                  aria-hidden="true"
                />
              ))}
              <div className="product-connect-merge-hub" aria-hidden="true">
                <span className="product-connect-merge-ring" />
                <FaIcon icon="link" size={11} className="text-ez-accent relative z-[1]" />
              </div>
            </div>

            <div className={`${flowNode} flex-shrink-0 !w-[4.5rem] !p-2.5`}>
              <FaIcon icon={EZ_APP_ICON} size={18} className="text-ez-accent" />
              <span className="text-[9px] font-semibold theme-heading mt-1 leading-tight text-center">InboxHire</span>
            </div>
          </div>
          <p className="type-caption theme-muted mt-1.5 text-left">OAuth2, Drive sync &amp; API connections</p>
        </div>

        {/* Scene 3 — Import candidates */}
        <div className="product-scene product-scene-3">
          <p className="product-step-label mb-3">Step 3 · AI imports candidates</p>
          <div className="flex items-center w-full gap-5">
            <div className={flowNode}>
              <FaIcon icon="envelope" size={18} className="text-ez-accent" />
              <span className="text-[9px] theme-heading mt-1">Gmail</span>
            </div>
            <div className="flex-1 relative h-10 min-w-[110px]">
              <div className="product-connector absolute top-1/2 left-0 right-0 h-px -translate-y-1/2" />
              <FaIcon icon="arrow-right" size={14} className="absolute right-0 top-1/2 -translate-y-1/2 text-ez-accent" />
              <div className="product-traveler product-traveler-1 product-avatar absolute top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-[#e8d5c4] text-[#8a5a3a] text-[9px] font-bold flex items-center justify-center">AS</div>
              <div className="product-traveler product-traveler-2 product-avatar absolute top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-[#c4d5e8] text-[#3a5a8a] text-[9px] font-bold flex items-center justify-center">SP</div>
              <div className="product-traveler product-traveler-3 product-avatar absolute top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-[#d5e8c4] text-[#3a8a5a] text-[9px] font-bold flex items-center justify-center">RV</div>
            </div>
            <div className={flowNode}>
              <FaIcon icon={EZ_APP_ICON} size={18} className="text-ez-accent" />
              <span className="text-[9px] theme-heading mt-1">InboxHire</span>
            </div>
          </div>
          <div className="mt-1.5 flex justify-start gap-2">
            <span className="product-badge text-ez-accent px-2.5 py-1 rounded-full inline-flex items-center gap-1">
              <FaIcon icon="robot" size={9} className="text-ez-accent" /> AI Scanning...
            </span>
            <span className="product-badge text-ez-accent-orange px-2.5 py-1 rounded-full">31 CVs found</span>
          </div>
        </div>

        {/* Scene 4 — Shortlist */}
        <div className="product-scene product-scene-4">
          <p className="product-step-label mb-2.5">Step 4 · Shortlist top talent</p>
          <div className="flex items-center w-full gap-2.5">
            {[
              { initials: 'AS', name: 'Arjun', score: 82, bg: 'bg-[#e8d5c4] text-[#8a5a3a]', ring: 'ring-[#2d8a5e]/45', delay: 'product-check-1', top: true },
              { initials: 'SP', name: 'Sneha', score: 76, bg: 'bg-[#c4d5e8] text-[#3a5a8a]', ring: 'ring-[#2d6a84]/20', delay: 'product-check-2', top: false },
              { initials: 'RV', name: 'Rahul', score: 74, bg: 'bg-[#d5e8c4] text-[#3a8a5a]', ring: 'ring-[#2d6a84]/20', delay: 'product-check-3', top: false },
            ].map((c) => (
              <div
                key={c.name}
                className={`product-glass-card flex-1 flex items-center gap-2 rounded-2xl px-2 py-1.5 ${c.ring} ring-1`}
              >
                <div className={`product-avatar w-7 h-7 rounded-full ${c.bg} flex items-center justify-center text-[9px] font-bold flex-shrink-0`}>
                  {c.initials}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <p className="text-[10px] font-semibold theme-heading truncate">{c.name}</p>
                    {c.top && (
                      <span className="text-[7px] font-bold text-[#2d8a5e] bg-[#2d8a5e]/10 px-1 py-0.5 rounded-full flex-shrink-0">TOP</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between mt-0.5">
                    <span className="text-[9px] font-bold text-[#4a9bb5]">{c.score}<span className="theme-muted font-normal">/100</span></span>
                    <div className={`${c.delay} flex items-center`}>
                      <FaIcon icon="circle-check" size={11} className="text-[#2d8a5e]" />
                    </div>
                  </div>
                </div>
              </div>
            ))}
            <div className="product-shortlist-btn flex-shrink-0 flex items-center gap-1.5 rounded-2xl px-3 py-2 min-w-[88px] text-white">
              <FaIcon icon="user-check" size={14} />
              <span className="text-[8px] font-semibold leading-tight">1-click<br />Shortlist</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ForgotPasswordScreen({ theme, onThemeChange, onBack, onError }) {
  const [email, setEmail] = useState('')
  const [phase, setPhase] = useState('form')
  const [sentMessage, setSentMessage] = useState(FORGOT_PASSWORD_MESSAGE)

  const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())

  const submitForgotPassword = async () => {
    if (!isValidEmail(email)) {
      onError?.('Enter a valid email address')
      return
    }
    setPhase('sending')
    try {
      const result = await forgotPassword({ email: email.trim() })
      setSentMessage(result.message || FORGOT_PASSWORD_MESSAGE)
      setPhase('sent')
    } catch (err) {
      setPhase('form')
      onError?.(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  const handleSend = () => {
    submitForgotPassword()
  }

  const handleResend = () => {
    submitForgotPassword()
  }

  return (
    <div className="min-h-screen relative signin-bg overflow-hidden">
      <div className="signin-mesh" aria-hidden="true">
        <div className="signin-blob signin-blob-1" />
        <div className="signin-blob signin-blob-2" />
        <div className="signin-blob signin-blob-3" />
        <div className="signin-blob signin-blob-4" />
        <div className="signin-blob signin-blob-5" />
      </div>

      <nav className="relative z-10 px-10 py-6 flex items-center justify-between animate-signin-nav">
        <Logo className="text-xl" />
        <div className="flex items-center gap-4">
          <button type="button" className="type-nav theme-nav-link">Documentation</button>
          <ThemeSwitcher theme={theme} onChange={onThemeChange} />
        </div>
      </nav>

      <div className="relative z-10 flex min-h-[calc(100vh-140px)]">
        <div className="flex-1 flex items-center pl-24 pr-4">
          <div className="w-full max-w-2xl">
            <h1 className="type-hero signin-title animate-signin-heading w-fit leading-[1.15]">
              Forgot your<br />password?
            </h1>
            <p className="type-subheading signin-para mt-4 animate-signin-subtext">
              No worries — enter your email and we&apos;ll send you a secure link<br />
              to reset your password in seconds.
            </p>
            <SignInProductDemo />
          </div>
        </div>

        <div className="flex-1 flex items-center justify-center pl-35 pr-8">
          <div className="signin-card forgot-password-card w-[420px] rounded-3xl p-10 ml-10 animate-signin-form">
            {phase !== 'sent' && (
              <button
                type="button"
                onClick={onBack}
                className="signup-back-btn type-caption theme-muted flex items-center gap-1.5 mb-6"
              >
                <FaIcon icon="arrow-left" size={12} /> Back to sign in
              </button>
            )}

            {phase === 'sent' ? (
              <div className="forgot-password-success text-center">
                <div className="forgot-password-mail-scene mx-auto mb-6" aria-hidden="true">
                  <div className="forgot-password-mail-ring forgot-password-mail-ring-1" />
                  <div className="forgot-password-mail-ring forgot-password-mail-ring-2" />
                  <div className="forgot-password-sent-badge">
                    <FaIcon icon="circle-check" size={34} />
                  </div>
                  <div className="forgot-password-mail-fly">
                    <FaIcon icon="envelope" size={22} />
                  </div>
                </div>
                <h2 className="type-section theme-heading">Check your inbox</h2>
                <p className="type-body theme-muted mt-3 leading-relaxed">
                  {sentMessage}
                </p>
                <p className="type-caption theme-muted mt-4">
                  Didn&apos;t receive it? Check spam or{' '}
                  <button type="button" onClick={handleResend} className="forgot-password-resend-link">
                    resend the email
                  </button>
                </p>
                <button
                  type="button"
                  onClick={onBack}
                  className="signup-continue-btn type-button text-white rounded-xl py-3 px-6 w-full mt-8"
                >
                  Return to sign in
                </button>
              </div>
            ) : (
              <>
                <h2 className="type-section signin-title w-fit">Reset password</h2>
                <p className="type-subheading signin-para mt-1 mb-8">
                  Enter your account email to receive a reset link.
                </p>

                <label htmlFor="forgot-password-email" className="type-label theme-muted mb-1.5 block">
                  Email address
                </label>
                {phase === 'sending' ? (
                  <div className="forgot-password-sending-panel mb-4" role="status" aria-live="polite">
                    <div className="forgot-password-sending-icon">
                      <FaIcon icon="paper-plane" size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="type-label theme-heading">Sending reset link…</p>
                      <p className="type-caption theme-muted mt-0.5 truncate">{email.trim()}</p>
                    </div>
                    <div className="forgot-password-sending-dots" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </div>
                  </div>
                ) : (
                  <>
                    <input
                      id="forgot-password-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@company.com"
                      autoComplete="email"
                      className="signin-input theme-input type-input rounded-xl px-4 py-3 w-full focus:outline-none mb-4"
                    />
                  </>
                )}

                <button
                  type="button"
                  onClick={handleSend}
                  disabled={phase === 'sending' || !email.trim()}
                  className="signup-continue-btn type-button text-white rounded-xl py-3 px-6 w-full disabled:opacity-45"
                >
                  Send reset link
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <footer className="absolute bottom-0 z-10 w-full text-center pb-4 animate-signin-footer">
        <p className="type-label theme-footer">
          POWERED BY DEEPTALENT TECHNOLOGIES. ALL RIGHTS RESERVED 2026 | TERMS | PRIVACY POLICY
        </p>
      </footer>
    </div>
  )
}

function ResetPasswordScreen({ theme, onThemeChange, resetToken, onSignIn, onForgotPassword, onError }) {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')
  const [showRequestNewLink, setShowRequestNewLink] = useState(false)

  const canSubmit = !!resetToken && password.length >= 8 && confirmPassword.length >= 8 && !submitting

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!resetToken) return
    if (password.length < 8) {
      onError?.('Password must be at least 8 characters')
      return
    }
    if (password !== confirmPassword) {
      onError?.('Passwords do not match')
      return
    }

    setSubmitting(true)
    setShowRequestNewLink(false)
    try {
      const result = await resetPassword({ reset_token: resetToken, new_password: password })
      setSuccessMessage(result.message || 'Password reset successfully. You can now log in.')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong'
      onError?.(message)
      if (/token/i.test(message)) setShowRequestNewLink(true)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen relative signin-bg overflow-hidden flex items-center justify-center px-4 py-10">
      <div className="signin-mesh" aria-hidden="true">
        <div className="signin-blob signin-blob-1" />
        <div className="signin-blob signin-blob-2" />
        <div className="signin-blob signin-blob-3" />
        <div className="signin-blob signin-blob-4" />
        <div className="signin-blob signin-blob-5" />
      </div>

      <div className="absolute top-6 right-6 z-20">
        <ThemeSwitcher theme={theme} onChange={onThemeChange} />
      </div>

      <div className="signin-card auth-form-card w-full max-w-md rounded-3xl p-10 relative z-10">
        {successMessage ? (
          <div className="text-center">
            <div className="auth-form-icon mx-auto mb-5">
              <FaIcon icon="circle-check" size={22} />
            </div>
            <h2 className="type-section theme-heading">Password updated</h2>
            <p className="type-body theme-muted mt-3 leading-relaxed">{successMessage}</p>
            <button
              type="button"
              onClick={onSignIn}
              className="signup-continue-btn type-button text-white rounded-xl py-3 px-6 w-full mt-8"
            >
              Go to sign in
            </button>
          </div>
        ) : !resetToken ? (
          <div className="text-center">
            <div className="auth-form-icon mx-auto mb-5">
              <FaIcon icon="triangle-exclamation" size={22} />
            </div>
            <h2 className="type-section theme-heading">Invalid reset link</h2>
            <p className="type-body theme-muted mt-3 leading-relaxed">
              This password reset link is missing or invalid. Request a new one — links expire after 1 hour.
            </p>
            <button
              type="button"
              onClick={onForgotPassword}
              className="signup-continue-btn type-button text-white rounded-xl py-3 px-6 w-full mt-8"
            >
              Forgot password?
            </button>
          </div>
        ) : (
          <>
            <div className="auth-form-icon mx-auto mb-5">
              <FaIcon icon="key" size={22} />
            </div>
            <h2 className="type-section theme-heading text-center">Reset your password</h2>
            <p className="type-body theme-muted mt-2 mb-8 text-center leading-relaxed">
              Enter a new password for your account.
            </p>

            <form onSubmit={handleSubmit}>
              <label htmlFor="reset-password-new" className="type-label theme-muted mb-1.5 block">
                New password
              </label>
              <div className="relative mb-4">
                <input
                  id="reset-password-new"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 8 characters"
                  autoComplete="new-password"
                  className="signin-input theme-input type-input rounded-xl px-4 py-3 w-full focus:outline-none pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 z-10 -translate-y-1/2 theme-muted"
                >
                  {showPassword ? <FaIcon icon="eye" size={18} /> : <FaIcon icon="eye-slash" size={18} />}
                </button>
              </div>

              <label htmlFor="reset-password-confirm" className="type-label theme-muted mb-1.5 block">
                Confirm password
              </label>
              <input
                id="reset-password-confirm"
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter your password"
                autoComplete="new-password"
                className="signin-input theme-input type-input rounded-xl px-4 py-3 w-full focus:outline-none mb-4"
              />

              {showRequestNewLink ? (
                <button
                  type="button"
                  onClick={onForgotPassword}
                  className="type-caption text-ez-accent font-medium hover:underline mb-4"
                >
                  Request a new reset link
                </button>
              ) : null}

              <button
                type="submit"
                disabled={!canSubmit}
                className="signup-continue-btn type-button text-white rounded-xl py-3 px-6 w-full disabled:opacity-45"
              >
                {submitting ? 'Saving…' : 'Reset password'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}

function scoreCircleStyle(score) {
  if (score >= 70) return 'bg-[#dcfce7] text-[#166534]'
  if (score >= 50) return 'bg-[#fef3c7] text-[#92400e]'
  return 'bg-[#fee2e2] text-[#991b1b]'
}

function stageBadgeStyle(stage) {
  if (stage === 'Shortlisted') return 'bg-[#dcfce7] text-[#166534]'
  if (stage === 'In Progress') return 'bg-[#fef3c7] text-[#92400e]'
  if (stage === 'Rejected') return 'bg-[#fee2e2] text-[#991b1b] opacity-50'
  return 'bg-[#e8f4f8] text-[#2d6a84]'
}

function normalizeSkillToken(value) {
  return value.toLowerCase().replace(/\.js$/i, '').replace(/[^a-z0-9]/g, '')
}

function candidateHasSkill(skill, candidateSkills) {
  const target = normalizeSkillToken(skill)
  return candidateSkills.find((item) => {
    const token = normalizeSkillToken(item)
    return token === target || token.includes(target) || target.includes(token)
  })
}

function parseCandidateYears(exp) {
  const match = exp.match(/(\d+)/)
  return match ? Number(match[1]) : null
}

function parseJobYearRange(experience) {
  const range = experience.match(/(\d+)\s*[–-]\s*(\d+)/)
  if (range) return { min: Number(range[1]), max: Number(range[2]) }
  const single = experience.match(/(\d+)\+/)
  if (single) return { min: Number(single[1]), max: null }
  return null
}

function educationMatches(jdEducation, candidateEducation) {
  const jd = jdEducation.toLowerCase()
  const cv = candidateEducation.toLowerCase()
  if (jd.includes('b.tech') && (cv.includes('b.tech') || cv.includes('b.e.'))) return true
  if (jd.includes('equivalent') && (cv.includes('b.tech') || cv.includes('b.e.') || cv.includes('m.tech') || cv.includes('b.sc'))) return true
  return jd.split(/\s+/).some((word) => word.length > 3 && cv.includes(word))
}

function buildJdCvAlignment(job, candidate) {
  if (candidate.apiAlignment) {
    return candidate.apiAlignment
  }

  const cvSkills = [...candidate.primary, ...candidate.secondary]
  const rows = []

  const yearRange = parseJobYearRange(job.experience)
  const candidateYears = parseCandidateYears(candidate.exp)
  const expMatched = yearRange && candidateYears !== null
    ? candidateYears >= yearRange.min && (yearRange.max === null || candidateYears <= yearRange.max)
    : false

  rows.push({
    category: 'Experience',
    jdLabel: job.experience,
    cvLabel: `${candidate.exp} · ${candidate.role}`,
    status: expMatched ? 'match' : 'gap',
  })

  rows.push({
    category: 'Education',
    jdLabel: job.education,
    cvLabel: candidate.edu,
    status: educationMatches(job.education, candidate.edu) ? 'match' : 'partial',
  })

  job.primarySkills.forEach((skill) => {
    const primaryHit = candidateHasSkill(skill, candidate.primary)
    const secondaryHit = candidateHasSkill(skill, candidate.secondary)
    rows.push({
      category: 'Must-have',
      jdLabel: skill,
      cvLabel: primaryHit || secondaryHit || 'Not found in CV',
      status: primaryHit ? 'match' : secondaryHit ? 'partial' : 'gap',
    })
  })

  job.secondarySkills.forEach((skill) => {
    const primaryHit = candidateHasSkill(skill, candidate.primary)
    const secondaryHit = candidateHasSkill(skill, candidate.secondary)
    rows.push({
      category: 'Nice-to-have',
      jdLabel: skill,
      cvLabel: primaryHit || secondaryHit || 'Not found in CV',
      status: primaryHit || secondaryHit ? 'match' : 'gap',
    })
  })

  const matched = rows.filter((row) => row.status === 'match').length
  const partial = rows.filter((row) => row.status === 'partial').length
  const matchPercent = Math.round(((matched + partial * 0.5) / rows.length) * 100)

  return { rows, matchPercent, matched, partial, total: rows.length }
}

const EMAIL_TEMPLATES = [
  { id: 'interview', label: 'Interview invite' },
  { id: 'shortlist', label: 'Shortlist update' },
  { id: 'followup', label: 'Follow-up' },
  { id: 'blank', label: 'Blank message' },
]

function buildEmailDraft(templateId, recipient, job) {
  const firstName = recipient.name.split(' ')[0]
  const jobTitle = job.title

  if (templateId === 'interview') {
    return {
      subject: `Interview invitation — ${jobTitle}`,
      body: `Hi ${firstName},

Thank you for applying for the ${jobTitle} role. We were impressed with your profile and would like to invite you to the next round.

Please share your availability for a 45-minute technical interview this week.

Best regards,
TalentHive Agency
InboxHire`,
    }
  }

  if (templateId === 'shortlist') {
    return {
      subject: `Update on your application — ${jobTitle}`,
      body: `Hi ${firstName},

Good news — you have been shortlisted for the ${jobTitle} position. Our team will reach out shortly with next steps.

Thank you for your patience.

Best regards,
TalentHive Agency
InboxHire`,
    }
  }

  if (templateId === 'followup') {
    return {
      subject: `Following up — ${jobTitle}`,
      body: `Hi ${firstName},

We are reviewing applications for the ${jobTitle} role and wanted to check if you are still interested in moving forward.

Feel free to reply with any questions.

Best regards,
TalentHive Agency
InboxHire`,
    }
  }

  return {
    subject: `Regarding your application — ${jobTitle}`,
    body: `Hi ${firstName},

`,
  }
}

function CandidateEmailModal({ open, recipients, job, onClose, onSent, onSendEmail }) {
  const [templateId, setTemplateId] = useState('interview')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  const primaryRecipient = recipients[0]

  useEffect(() => {
    if (!open || !primaryRecipient) return undefined
    const draft = buildEmailDraft('interview', primaryRecipient, job)
    setTemplateId('interview')
    setSubject(draft.subject)
    setBody(draft.body)
    setError('')
    setSending(false)

    const onKeyDown = (e) => {
      if (e.key === 'Escape' && !sending) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    lockPageScroll()
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      unlockPageScroll()
    }
  }, [open, primaryRecipient?.id, job.title, onClose, sending])

  const applyTemplate = (nextTemplateId) => {
    if (!primaryRecipient) return
    const draft = buildEmailDraft(nextTemplateId, primaryRecipient, job)
    setTemplateId(nextTemplateId)
    setSubject(draft.subject)
    setBody(draft.body)
  }

  const handleSend = async () => {
    if (!subject.trim()) {
      setError('Add a subject line before sending.')
      return
    }
    if (!body.trim()) {
      setError('Add a message before sending.')
      return
    }

    setError('')
    setSending(true)
    try {
      if (onSendEmail) {
        await onSendEmail({
          subject: subject.trim(),
          bodyHtml: body.trim(),
          applicationIds: recipients.map((recipient) => recipient.applicationId || recipient.id),
        })
      } else {
        await new Promise((resolve) => setTimeout(resolve, 1100))
      }
      onSent?.(recipients.length)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send email')
    } finally {
      setSending(false)
    }
  }

  if (!open || recipients.length === 0) return null

  return (
    <div
      className="candidate-email-overlay fixed inset-0 z-[75] flex items-center justify-center p-4 md:p-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="candidate-email-title"
    >
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close email composer" onClick={() => !sending && onClose()} />
      <div className="candidate-email-modal relative w-full max-w-2xl flex flex-col max-h-[90vh]">
        <div className="candidate-email-glow" aria-hidden="true" />

        <div className="candidate-email-header flex items-start justify-between gap-4 p-5 md:p-6 flex-shrink-0 relative">
          <div className="min-w-0">
            <p className="candidate-email-kicker">Compose email</p>
            <h2 id="candidate-email-title" className="candidate-email-title theme-heading">
              Send to {recipients.length === 1 ? recipients[0].name : `${recipients.length} candidates`}
            </h2>
            <p className="type-caption theme-muted mt-1">
              {recipients.length > 1
                ? 'Each candidate receives a personalised greeting when sent.'
                : recipients[0].email}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="candidate-email-close"
            aria-label="Close"
          >
            <FaIcon icon="xmark" size={14} />
          </button>
        </div>

        <div className="candidate-email-body flex-1 overflow-y-auto px-5 md:px-6 pb-5 md:pb-6 relative space-y-4">
          <div>
            <label className="type-label theme-muted mb-1.5 block">To</label>
            <div className="candidate-email-recipients">
              {recipients.map((recipient) => (
                <span key={recipient.id} className="candidate-email-recipient-chip">
                  <span className="candidate-email-recipient-avatar">{getInitials(recipient.name)}</span>
                  <span className="min-w-0">
                    <span className="candidate-email-recipient-name">{recipient.name}</span>
                    <span className="candidate-email-recipient-email">{recipient.email}</span>
                  </span>
                </span>
              ))}
            </div>
          </div>

          <div>
            <label className="type-label theme-muted mb-1.5 block" htmlFor="email-template">Template</label>
            <select
              id="email-template"
              value={templateId}
              onChange={(e) => applyTemplate(e.target.value)}
              className="candidate-email-select theme-input type-input border rounded-xl px-4 py-2.5 w-full focus:outline-none"
              disabled={sending}
            >
              {EMAIL_TEMPLATES.map((template) => (
                <option key={template.id} value={template.id}>{template.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="type-label theme-muted mb-1.5 block" htmlFor="email-subject">Subject</label>
            <input
              id="email-subject"
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="theme-input type-input border rounded-xl px-4 py-3 w-full focus:outline-none focus:ring-2 focus:ring-[#2d6a84] focus:border-transparent"
              disabled={sending}
            />
          </div>

          <div>
            <label className="type-label theme-muted mb-1.5 block" htmlFor="email-body">Message</label>
            <textarea
              id="email-body"
              rows={10}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="modern-textarea theme-input type-input border rounded-xl px-4 py-3 w-full focus:outline-none focus:ring-2 focus:ring-[#2d6a84] focus:border-transparent resize-none"
              disabled={sending}
            />
          </div>

          {error && (
            <p className="candidate-email-error type-caption" role="alert">{error}</p>
          )}
        </div>

        <div className="candidate-email-footer flex items-center justify-between gap-3 p-5 md:px-6 md:pb-6 flex-shrink-0 relative">
          <p className="type-caption theme-muted hidden sm:block">
            Sent via your connected Gmail workspace
          </p>
          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={onClose}
              disabled={sending}
              className="dashboard-outline-btn type-button rounded-xl py-2.5 px-4 theme-heading"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSend}
              disabled={sending}
              className="signin-btn-primary type-button text-white rounded-xl py-2.5 px-5 flex items-center gap-2"
            >
              {sending ? (
                <>
                  <FaIcon icon="spinner" size={14} className="candidate-email-send-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <FaIcon icon="paper-plane" size={14} />
                  Send email{recipients.length > 1 ? ` (${recipients.length})` : ''}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function SkillProficiencyCard({ skill }) {
  const level = skill.proficiency >= 80 ? 'high' : skill.proficiency >= 60 ? 'mid' : 'low'

  return (
    <div className={`skill-modern-card skill-modern-card-${level}`}>
      <div className="skill-modern-ring" style={{ '--skill-pct': skill.proficiency }}>
        <span className="skill-modern-ring-value">{skill.proficiency}</span>
      </div>
      <div className="skill-modern-info min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="skill-modern-name theme-heading">{skill.name}</span>
          {skill.jdMatch && <span className="skill-jd-match-badge">JD match</span>}
        </div>
        <span className="skill-modern-years type-caption theme-muted">{skill.years} yrs experience</span>
      </div>
    </div>
  )
}

function JdCvAlignmentMap({ job, candidate }) {
  const alignment = buildJdCvAlignment(job, candidate)

  return (
    <div className="jd-cv-alignment modern-panel">
      <div className="modern-panel-glow" aria-hidden="true" />
      <div className="jd-cv-alignment-header flex items-start justify-between gap-4 mb-5 relative">
        <div>
          <span className="modern-eyebrow">AI Match Analysis</span>
          <h3 className="type-card-title theme-heading mt-1">JD ↔ CV Alignment</h3>
          <p className="type-caption theme-muted mt-1">
            Requirements mapped against parsed resume data
          </p>
        </div>
        <div className="jd-cv-match-ring flex-shrink-0" style={{ '--match-pct': alignment.matchPercent }}>
          <span className="jd-cv-match-ring-value">{alignment.matchPercent}%</span>
          <span className="jd-cv-match-ring-label">match</span>
        </div>
      </div>

      <div className="jd-cv-alignment-legend flex flex-wrap gap-2 mb-5 relative">
        <span className="jd-cv-legend-item jd-cv-legend-match">
          <FaIcon icon="circle-check" size={11} /> {alignment.matched} matched
        </span>
        <span className="jd-cv-legend-item jd-cv-legend-partial">
          <FaIcon icon="circle-half-stroke" size={11} /> {alignment.partial} partial
        </span>
        <span className="jd-cv-legend-item jd-cv-legend-gap">
          <FaIcon icon="circle-xmark" size={11} /> {alignment.total - alignment.matched - alignment.partial} gaps
        </span>
      </div>

      <div className="jd-cv-column-labels grid grid-cols-[1fr_auto_1fr] gap-3 mb-3 relative">
        <span className="jd-cv-column-pill jd-cv-column-pill-jd">
          <FaIcon icon="briefcase" size={11} /> Job Description
        </span>
        <span className="w-10" aria-hidden="true" />
        <span className="jd-cv-column-pill jd-cv-column-pill-cv justify-end">
          <FaIcon icon="file-lines" size={11} /> Candidate CV
        </span>
      </div>

      <div className="jd-cv-alignment-rows space-y-2 relative">
        {alignment.rows.map((row) => (
          <div key={`${row.category}-${row.jdLabel}`} className={`jd-cv-row jd-cv-row-${row.status}`}>
            <div className="jd-cv-row-jd">
              <span className="jd-cv-row-category">{row.category}</span>
              <span className="jd-cv-row-text theme-heading">{row.jdLabel}</span>
            </div>
            <div className="jd-cv-row-bridge" aria-hidden="true">
              <span className="jd-cv-bridge-line" />
              <span className="jd-cv-bridge-node">
                <FaIcon
                  icon={row.status === 'match' ? 'check' : row.status === 'partial' ? 'minus' : 'xmark'}
                  size={10}
                />
              </span>
              <span className="jd-cv-bridge-line" />
            </div>
            <div className="jd-cv-row-cv">
              <span className={`jd-cv-row-text ${row.status === 'gap' ? 'jd-cv-row-text-gap' : 'theme-heading'}`}>
                {row.cvLabel}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const CANDIDATE_PROFILES = {
  1: {
    summary: 'Senior frontend engineer with 5 years of experience shipping production React applications at scale. Strong full-stack exposure with TypeScript, Node.js, and AWS. Led component library adoption and mentored junior developers.',
    highlights: ['Led React migration for 2M+ user product', 'Open-source contributor — 1.2k GitHub stars', 'Available in 30 days · Bangalore'],
    skills: [
      { name: 'React.js', proficiency: 96, years: 4.5, tier: 'core' },
      { name: 'TypeScript', proficiency: 92, years: 3.5, tier: 'core' },
      { name: 'Node.js', proficiency: 78, years: 2.5, tier: 'core' },
      { name: 'AWS', proficiency: 72, years: 2, tier: 'core' },
      { name: 'PostgreSQL', proficiency: 68, years: 2, tier: 'support' },
      { name: 'GraphQL', proficiency: 65, years: 1.5, tier: 'support' },
      { name: 'Docker', proficiency: 60, years: 1, tier: 'support' },
    ],
    experience: [
      { company: 'Razorpay', title: 'Senior Frontend Engineer', period: '2022 – Present', relevance: 96, bullets: ['Built merchant dashboard serving 500k+ daily users', 'Architected design-system in React + TypeScript'] },
      { company: 'Freshworks', title: 'Frontend Developer', period: '2020 – 2022', relevance: 88, bullets: ['Developed customer-facing SaaS modules in React', 'Improved Core Web Vitals by 35%'] },
      { company: 'TCS Digital', title: 'Associate Developer', period: '2019 – 2020', relevance: 72, bullets: ['Maintained enterprise web apps', 'Introduced unit testing with Jest'] },
    ],
  },
  2: {
    summary: 'React specialist with 4 years of product engineering experience. Deep expertise in component architecture, REST APIs, and performance optimization. Proven track record in agile product teams.',
    highlights: ['Shortlisted for internal tech lead role', 'Built reusable component library', 'Pune · open to remote'],
    skills: [
      { name: 'React', proficiency: 90, years: 4, tier: 'core' },
      { name: 'TypeScript', proficiency: 85, years: 3, tier: 'core' },
      { name: 'REST APIs', proficiency: 82, years: 3.5, tier: 'core' },
      { name: 'PostgreSQL', proficiency: 70, years: 2, tier: 'support' },
      { name: 'Docker', proficiency: 58, years: 1, tier: 'support' },
    ],
    experience: [
      { company: 'Zoho', title: 'React Developer', period: '2021 – Present', relevance: 92, bullets: ['Owned CRM widget ecosystem in React', 'Reduced bundle size by 28%'] },
      { company: 'Mindtree', title: 'Software Engineer', period: '2020 – 2021', relevance: 78, bullets: ['Delivered client portals using React and Redux'] },
    ],
  },
  3: {
    summary: 'Full-stack developer with 6 years building React and Node.js applications. Strong database design skills and experience with cloud deployments. Comfortable owning features end-to-end.',
    highlights: ['6 yrs total experience', 'M.Tech from NIT Trichy', 'Hyderabad · hybrid OK'],
    skills: [
      { name: 'React', proficiency: 88, years: 5, tier: 'core' },
      { name: 'Node.js', proficiency: 86, years: 4.5, tier: 'core' },
      { name: 'PostgreSQL', proficiency: 84, years: 4, tier: 'core' },
      { name: 'AWS', proficiency: 74, years: 2.5, tier: 'support' },
      { name: 'TypeScript', proficiency: 70, years: 2, tier: 'support' },
    ],
    experience: [
      { company: 'PhonePe', title: 'Full Stack Developer', period: '2021 – Present', relevance: 94, bullets: ['Built payment flows with React + Node.js', 'Designed PostgreSQL schemas for ledger service'] },
      { company: 'Capgemini', title: 'Software Developer', period: '2018 – 2021', relevance: 80, bullets: ['Developed internal tools and REST microservices'] },
    ],
  },
  4: {
    summary: 'Frontend engineer with 5 years crafting responsive, accessible web experiences. Proficient in React ecosystem with growing Next.js expertise. Strong eye for UI polish and clean code practices.',
    highlights: ['Production React apps in fintech', 'Next.js side projects deployed', 'Chennai · 60-day notice'],
    skills: [
      { name: 'React', proficiency: 88, years: 4.5, tier: 'core' },
      { name: 'JavaScript', proficiency: 90, years: 5, tier: 'core' },
      { name: 'TypeScript', proficiency: 82, years: 3, tier: 'core' },
      { name: 'Next.js', proficiency: 72, years: 1.5, tier: 'support' },
      { name: 'Tailwind', proficiency: 78, years: 2, tier: 'support' },
    ],
    experience: [
      { company: 'Paytm', title: 'Frontend Engineer', period: '2022 – Present', relevance: 90, bullets: ['Shipped consumer wallet UI in React', 'Migrated legacy jQuery modules to TypeScript'] },
      { company: 'Infosys', title: 'Systems Engineer', period: '2019 – 2022', relevance: 76, bullets: ['Built dashboard products for banking clients', 'Collaborated with UX on design system'] },
    ],
  },
  5: {
    summary: 'React developer with 3 years of experience in startup environments. Solid JavaScript fundamentals and eagerness to grow into senior responsibilities. Quick learner with hands-on Redux experience.',
    highlights: ['Startup exposure — fast-paced delivery', 'BCA graduate with self-taught React', 'Mumbai · immediate joiner'],
    skills: [
      { name: 'React', proficiency: 75, years: 3, tier: 'core' },
      { name: 'JavaScript', proficiency: 78, years: 3, tier: 'core' },
      { name: 'CSS', proficiency: 72, years: 3, tier: 'support' },
      { name: 'Redux', proficiency: 68, years: 2, tier: 'support' },
    ],
    experience: [
      { company: 'Groww', title: 'React Developer', period: '2022 – Present', relevance: 82, bullets: ['Built investment onboarding flows', 'Integrated REST APIs with React Query'] },
      { company: 'Freelance', title: 'Web Developer', period: '2021 – 2022', relevance: 65, bullets: ['Delivered landing pages and small SPAs for clients'] },
    ],
  },
  6: {
    summary: 'Junior frontend developer with 2 years of experience building React interfaces. Eager to deepen TypeScript and testing skills. Strong HTML/CSS foundation and collaborative team player.',
    highlights: ['2 yrs commercial experience', 'B.Sc IT graduate, 2022', 'Hyderabad'],
    skills: [
      { name: 'React', proficiency: 62, years: 2, tier: 'core' },
      { name: 'HTML/CSS', proficiency: 80, years: 2, tier: 'core' },
      { name: 'JavaScript', proficiency: 58, years: 2, tier: 'support' },
    ],
    experience: [
      { company: 'Darwinbox', title: 'Junior Frontend Dev', period: '2022 – Present', relevance: 70, bullets: ['Maintained HRMS UI components in React', 'Fixed accessibility issues across modules'] },
    ],
  },
  7: {
    summary: 'Entry-level developer with 1 year of internship and trainee experience. Learning React and modern frontend tooling. Motivated graduate seeking mentorship-heavy roles.',
    highlights: ['1 yr trainee experience', 'BCA from DU, 2023', 'Delhi · fresher-friendly'],
    skills: [
      { name: 'React', proficiency: 48, years: 1, tier: 'core' },
      { name: 'HTML', proficiency: 70, years: 1.5, tier: 'core' },
      { name: 'JavaScript', proficiency: 45, years: 1, tier: 'support' },
    ],
    experience: [
      { company: 'Wipro', title: 'Trainee Developer', period: '2023 – Present', relevance: 55, bullets: ['Assisted on internal React prototypes', 'Completed full-stack training program'] },
    ],
  },
}

function deriveSkillsFromCandidate(candidate, job) {
  const allSkills = [...new Set([...candidate.primary, ...candidate.secondary])]
  if (allSkills.length === 0) return []

  const jdSkills = [...(job.primarySkills || []), ...(job.secondarySkills || [])]
  const totalYears = parseCandidateYears(candidate.exp) ?? 3

  return allSkills.map((name, index) => {
    const inPrimary = candidate.primary.some((skill) => candidateHasSkill(name, [skill]))
    const jdMatch = jdSkills.some((jd) => candidateHasSkill(jd, [name]))
    let proficiency = Math.min(
      96,
      Math.max(55, candidate.score - 8 + (jdMatch ? 12 : 0) + (inPrimary ? 6 : 0) - index * 2),
    )
    if (jdMatch && inPrimary) proficiency = Math.min(96, proficiency + 6)

    return {
      name,
      proficiency: Math.round(proficiency),
      years: Math.round(Math.max(0.5, totalYears * (0.9 - index * 0.08)) * 10) / 10,
      tier: inPrimary || jdMatch ? 'core' : 'support',
      jdMatch,
    }
  }).sort((a, b) => b.proficiency - a.proficiency)
}

function deriveExperienceFromCandidate(candidate, job) {
  const alignment = buildJdCvAlignment(job, candidate)
  const expRow = alignment.rows.find((row) => row.category.toLowerCase().includes('experience'))
  const company = candidate.role?.includes(' at ')
    ? candidate.role.split(' at ').slice(1).join(' at ')
    : ''

  return [{
    company,
    title: candidate.role?.split(' at ')?.[0] || candidate.role || 'Professional role',
    period: candidate.exp || '—',
    relevance: alignment.matchPercent,
    bullets: expRow && expRow.cvLabel && expRow.cvLabel !== 'Not found in CV'
      ? [`${expRow.cvLabel} vs JD requirement: ${expRow.jdLabel}`]
      : ['Work history extracted from parsed CV'],
    skillsUsed: [],
  }]
}

function getCandidateProfile(candidate, job) {
  const mockProfile = CANDIDATE_PROFILES[candidate.id]
  if (mockProfile) {
    const jdSkills = [...(job.primarySkills || []), ...(job.secondarySkills || [])]
    const skills = mockProfile.skills.map((skill) => ({
      ...skill,
      jdMatch: jdSkills.some((jd) => candidateHasSkill(jd, [skill.name])),
    }))
    return {
      ...mockProfile,
      skills,
    }
  }

  const jdSkills = [...(job.primarySkills || []), ...(job.secondarySkills || [])]
  const skills = (candidate.skillsBreakdown?.length
    ? candidate.skillsBreakdown.map((skill) => ({
      ...skill,
      jdMatch: jdSkills.some((jd) => candidateHasSkill(jd, [skill.name])),
    }))
    : deriveSkillsFromCandidate(candidate, job))

  const experience = candidate.experienceBreakdown?.length
    ? candidate.experienceBreakdown
    : deriveExperienceFromCandidate(candidate, job)

  const skillNames = skills.map((skill) => skill.name).slice(0, 3).join(', ')
  const summary = candidate.summary
    || (skillNames
      ? `${candidate.name} brings ${candidate.exp || 'relevant'} experience across ${skillNames}.`
      : `${candidate.name} profile parsed from CV with an overall match score of ${candidate.score}.`)

  const highlights = [
    candidate.exp && `${candidate.exp} total experience`,
    candidate.location && `${candidate.location}`,
    candidate.edu && candidate.edu,
  ].filter(Boolean)

  if (skills.length === 0 && experience.length === 0) {
    return null
  }

  return { summary, highlights, skills, experience }
}

function CandidateProfileInsights({ candidate, job }) {
  const profile = getCandidateProfile(candidate, job)
  if (!profile) return null

  const alignment = buildJdCvAlignment(job, candidate)
  const coreSkills = profile.skills.filter((s) => s.tier === 'core')
  const supportSkills = profile.skills.filter((s) => s.tier === 'support')
  const jdMatchedSkills = profile.skills.filter((s) => s.jdMatch).length

  return (
    <div className="candidate-profile-insights space-y-5">
      <div className="profile-summary-card modern-panel">
        <div className="modern-panel-glow profile-summary-glow" aria-hidden="true" />
        <div className="relative">
          <div className="flex items-start justify-between gap-4 mb-5">
            <div className="flex items-start gap-4 min-w-0">
              <div className="profile-summary-icon flex-shrink-0">
                <FaIcon icon={EZ_APP_ICON} size={20} />
              </div>
              <div className="min-w-0">
                <span className="modern-eyebrow">AI Resume Parse</span>
                <h3 className="type-card-title theme-heading mt-1">Professional Summary</h3>
              </div>
            </div>
          </div>

          <div className="profile-stats-strip">
            <div className="profile-stat-chip">
              <span className="profile-stat-value">{candidate.score}</span>
              <span className="profile-stat-label">AI Score</span>
            </div>
            <div className="profile-stat-chip">
              <span className="profile-stat-value">{candidate.exp.replace(' yrs', '')}</span>
              <span className="profile-stat-label">Years Exp</span>
            </div>
            <div className="profile-stat-chip">
              <span className="profile-stat-value">{jdMatchedSkills}</span>
              <span className="profile-stat-label">JD Skills</span>
            </div>
            <div className="profile-stat-chip">
              <span className="profile-stat-value">{alignment.matchPercent}%</span>
              <span className="profile-stat-label">JD Match</span>
            </div>
          </div>

          <p className="type-body theme-muted mt-5 leading-relaxed">{profile.summary}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="modern-panel">
          <div className="modern-panel-glow" aria-hidden="true" />
          <div className="relative">
            <div className="flex items-center justify-between mb-5">
              <div>
                <span className="modern-eyebrow">Proficiency Map</span>
                <h3 className="type-card-title theme-heading mt-1">Skill Breakdown</h3>
              </div>
              <span className="profile-section-badge type-caption">
                <FaIcon icon="chart-simple" size={11} /> {profile.skills.length} skills
              </span>
            </div>

            {coreSkills.length > 0 && (
              <>
                <p className="type-label theme-muted mb-3">Core skills</p>
                <div className="skill-modern-grid mb-5">
                  {coreSkills.map((skill) => (
                    <SkillProficiencyCard key={skill.name} skill={skill} />
                  ))}
                </div>
              </>
            )}

            {supportSkills.length > 0 && (
              <>
                <p className="type-label theme-muted mb-3">Supporting skills</p>
                <div className="skill-modern-grid">
                  {supportSkills.map((skill) => (
                    <SkillProficiencyCard key={skill.name} skill={skill} />
                  ))}
                </div>
              </>
            )}

            {profile.skills.length === 0 && (
              <p className="type-caption theme-muted">No skill data parsed from CV yet.</p>
            )}
          </div>
        </div>

        <div className="modern-panel">
          <div className="modern-panel-glow" aria-hidden="true" />
          <div className="relative">
            <div className="flex items-center justify-between mb-5">
              <div>
                <span className="modern-eyebrow">Career Timeline</span>
                <h3 className="type-card-title theme-heading mt-1">Experience Breakdown</h3>
              </div>
              <span className="profile-section-badge type-caption">
                <FaIcon icon="clock-rotate-left" size={11} /> {profile.experience.length} ROLES
              </span>
            </div>

            <div className="experience-modern-list space-y-3">
              {profile.experience.map((role, index) => (
                <div key={`${role.title}-${role.period}-${index}`} className="experience-modern-card">
                  <div className="experience-modern-card-top">
                    <div className="experience-company-avatar" aria-hidden="true">
                      {(role.company || role.title).charAt(0)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="type-subheading theme-heading">{role.title}</p>
                      {role.company && role.company !== 'Company not listed' && (
                        <p className="type-caption theme-muted mt-0.5">{role.company}</p>
                      )}
                      {role.period && role.period !== '—' && (
                        <p className="type-caption theme-muted">{role.period}</p>
                      )}
                    </div>
                    <span className={`experience-relevance-badge experience-relevance-${role.relevance >= 85 ? 'high' : role.relevance >= 70 ? 'mid' : 'low'}`}>
                      {role.relevance}% fit
                    </span>
                  </div>
                  <ul className="experience-bullets mt-3 space-y-1.5">
                    {role.bullets.map((bullet) => (
                      <li key={bullet} className="type-caption theme-muted flex gap-2">
                        <FaIcon icon="check" size={10} className="mt-0.5 flex-shrink-0 text-[#2d8a5e]" />
                        <span>{bullet}</span>
                      </li>
                    ))}
                  </ul>
                  {role.skillsUsed?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {role.skillsUsed.map((skill) => (
                        <span key={skill} className="profile-highlight-pill type-caption">
                          {skill}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {profile.experience.length === 0 && (
                <p className="type-caption theme-muted">No experience history parsed from CV yet.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function getCandidateMatchPercent(candidate) {
  return candidate.apiAlignment?.matchPercent ?? candidate.score ?? null
}

function CandidateDetailView({ candidate, job, onSaveNote, onUpdateStage, onOpenResume, onSendEmail }) {
  const [noteText, setNoteText] = useState(candidate.recruiterNote || '')
  const [savingNote, setSavingNote] = useState(false)

  useEffect(() => {
    setNoteText(candidate.recruiterNote || '')
  }, [candidate.id])

  const handleSaveNote = async () => {
    if (!onSaveNote || savingNote) return
    setSavingNote(true)
    try {
      await onSaveNote(candidate.applicationId || candidate.id, noteText)
    } finally {
      setSavingNote(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="modern-candidate-header modern-panel flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="modern-panel-glow modern-candidate-header-glow" aria-hidden="true" />
        <div className="flex items-center gap-4 relative min-w-0">
          <div className="candidate-profile-avatar">
            {getInitials(candidate.name)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="type-card-title theme-heading truncate">{candidate.name}</h2>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="#928DDD" className="flex-shrink-0"><path d="M16 8a6 6 0 016 6v7h-4v-7a2 2 0 00-4 0v7h-4v-7a6 6 0 016-6zM2 9h4v12H2zM4 6a2 2 0 100-4 2 2 0 000 4z"/></svg>
            </div>
            <p className="type-body theme-muted">{candidate.role} · {candidate.exp} Exp</p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1">
              {candidate.location && (
                <span className="type-caption theme-muted flex items-center gap-1">
                  <FaIcon icon="location-dot" size={12} /> {candidate.location.toUpperCase()}
                </span>
              )}
              {candidate.email && (
                <span className="type-caption theme-muted flex items-center gap-1 truncate">
                  <FaIcon icon="at" size={12} /> {candidate.email.toUpperCase()}
                </span>
              )}
              {candidate.phone && (
                <span className="type-caption theme-muted flex items-center gap-1">
                  <FaIcon icon="phone" size={12} /> {candidate.phone}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 relative flex-shrink-0">
          <button
            type="button"
            onClick={() => onSendEmail?.([candidate.id])}
            className="signin-btn-primary type-button text-white rounded-xl py-2.5 px-4 flex items-center gap-2"
          >
            <FaIcon icon="envelope" size={14} /> Send Email
          </button>
          <button
            type="button"
            onClick={() => onUpdateStage(candidate.id, 'Shortlisted')}
            className="dashboard-outline-btn type-button rounded-xl py-2.5 px-4 flex items-center gap-2 theme-heading"
          >
            <FaIcon icon="user-plus" size={14} /> Shortlist
          </button>
          <button
            type="button"
            onClick={() => onUpdateStage(candidate.id, 'In Progress')}
            className="dashboard-outline-btn type-button text-[#92400e] rounded-xl py-2.5 px-4 flex items-center gap-2"
          >
            <FaIcon icon="spinner" size={14} /> Mark In Progress
          </button>
          <button
            type="button"
            onClick={() => onUpdateStage(candidate.id, 'Rejected')}
            className="dashboard-outline-btn type-button text-[#e8824a] rounded-xl py-2.5 px-4"
          >
            Reject
          </button>
        </div>
      </div>

      <JdCvAlignmentMap job={job} candidate={candidate} />
      <CandidateProfileInsights candidate={candidate} job={job} />

      <div className="modern-panel">
        <div className="modern-panel-glow" aria-hidden="true" />
        <div className="relative">
          <span className="modern-eyebrow">Internal</span>
          <h3 className="type-card-title theme-heading mt-1 mb-4">Recruiter Notes</h3>
          <textarea
            rows={4}
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            className="modern-textarea theme-input type-input border rounded-xl px-4 py-3 w-full focus:outline-none focus:ring-2 focus:ring-[#2d6a84] focus:border-transparent resize-none"
          />
          <button
            type="button"
            onClick={handleSaveNote}
            disabled={savingNote}
            className="portfolio-save-note type-button mt-3 rounded-xl py-2 px-4 disabled:opacity-60"
          >
            {savingNote ? 'Saving…' : 'Save Note'}
          </button>
        </div>
      </div>

      <div className="resume-open-card w-full">
        <div className="resume-open-card-icon">
          <FaIcon icon="file-pdf" size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="type-subheading theme-heading truncate">{candidate.name.replace(/\s+/g, '_')}_CV.pdf</p>
          <p className="type-caption theme-muted">View the real PDF with JD match highlights overlaid</p>
        </div>
        <button
          type="button"
          onClick={onOpenResume}
          className="resume-open-card-action type-caption"
        >
          View Resume <FaIcon icon="arrow-right" size={12} />
        </button>
      </div>
    </div>
  )
}

function CandidateProfileDrawer({ open, candidate, job, onSaveNote, onUpdateStage, onOpenResume, onClose }) {
  const getDefaultDrawerWidth = () => Math.min(window.innerWidth * 0.72, 896)
  const clampDrawerWidth = (width) => Math.min(window.innerWidth * 0.96, Math.max(320, width))

  const [drawerWidth, setDrawerWidth] = useState(getDefaultDrawerWidth)
  const resizeRef = useRef({ active: false, startX: 0, startWidth: 0 })

  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    lockPageScroll()
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      unlockPageScroll()
    }
  }, [open, onClose])

  useEffect(() => {
    if (!open) {
      setDrawerWidth(getDefaultDrawerWidth())
      return undefined
    }

    const onPointerMove = (e) => {
      if (!resizeRef.current.active) return
      const delta = resizeRef.current.startX - e.clientX
      setDrawerWidth(clampDrawerWidth(resizeRef.current.startWidth + delta))
    }

    const endResize = () => {
      if (!resizeRef.current.active) return
      resizeRef.current.active = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', endResize)
    window.addEventListener('pointercancel', endResize)

    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', endResize)
      window.removeEventListener('pointercancel', endResize)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [open])

  const startResize = (e) => {
    e.preventDefault()
    resizeRef.current = {
      active: true,
      startX: e.clientX,
      startWidth: drawerWidth,
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  if (!open || !candidate) return null

  return (
    <div className="candidate-drawer-root">
      <button
        type="button"
        className="candidate-drawer-backdrop"
        onClick={onClose}
        aria-label="Close candidate profile"
      />
      <aside
        className="candidate-drawer-panel"
        style={{ width: drawerWidth }}
        role="dialog"
        aria-modal="true"
        aria-label={`${candidate.name} profile`}
      >
        <div
          className="candidate-drawer-resize-handle"
          onPointerDown={startResize}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize drawer"
          title="Drag to resize"
        >
          <span className="candidate-drawer-resize-grip" aria-hidden="true" />
        </div>
        <div className="candidate-drawer-content">
          <div className="candidate-drawer-toolbar">
            <p className="type-subheading font-semibold theme-heading">Candidate Profile</p>
            <button type="button" onClick={onClose} className="candidate-drawer-close" aria-label="Close">
              <FaIcon icon="xmark" size={16} />
            </button>
          </div>
          <div className="candidate-drawer-body">
            <CandidateDetailView
              candidate={candidate}
              job={job}
              onSaveNote={onSaveNote}
              onUpdateStage={onUpdateStage}
              onOpenResume={onOpenResume}
            />
          </div>
        </div>
      </aside>
    </div>
  )
}

function Skeleton({ className = '' }) {
  return <span className={`ez-skeleton ${className}`} aria-hidden="true" />
}

function DashboardJobLimitSkeleton() {
  return (
    <div className="dashboard-job-limit-skeleton mt-2" aria-label="Loading usage" role="status">
      <Skeleton className="ez-skeleton-line ez-skeleton-line-lg" />
      <Skeleton className="ez-skeleton-line ez-skeleton-track mt-3" />
      <div className="flex justify-between mt-3 gap-3">
        <Skeleton className="ez-skeleton-line ez-skeleton-line-sm" />
        <Skeleton className="ez-skeleton-line ez-skeleton-line-xs" />
      </div>
    </div>
  )
}

function JobPortfolioCardSkeleton() {
  return (
    <div className="dashboard-card job-portfolio-card job-portfolio-card-skeleton rounded-2xl p-6" aria-hidden="true">
      <div className="flex justify-between items-start gap-3">
        <Skeleton className="ez-skeleton-pill" />
        <Skeleton className="ez-skeleton-icon-btn" />
      </div>
      <Skeleton className="ez-skeleton-line ez-skeleton-line-title mt-4" />
      <Skeleton className="ez-skeleton-line ez-skeleton-line-sm mt-2" />
      <div className="portfolio-metrics mt-5">
        <div className="portfolio-metrics-row portfolio-metrics-row-top">
          <Skeleton className="portfolio-metric-skeleton" />
          <Skeleton className="portfolio-metric-skeleton" />
          <Skeleton className="portfolio-metric-skeleton" />
        </div>
        <div className="portfolio-metrics-row portfolio-metrics-row-bottom">
          <Skeleton className="portfolio-metric-skeleton" />
          <Skeleton className="portfolio-metric-skeleton" />
        </div>
      </div>
      <Skeleton className="ez-skeleton-button mt-4" />
    </div>
  )
}

function SourcePickerSkeleton() {
  return (
    <div className="job-source-picker-grid" aria-label="Loading connected sources" role="status">
      {[0, 1].map((index) => (
        <div key={index} className="scan-source-card job-scan-source-card job-scan-source-card-skeleton" aria-hidden="true">
          <Skeleton className="ez-skeleton-icon-btn mb-4" style={{ width: '3.35rem', height: '3.35rem', borderRadius: '1rem' }} />
          <Skeleton className="ez-skeleton-line ez-skeleton-line-title" />
          <Skeleton className="ez-skeleton-line ez-skeleton-line-md mt-3" />
          <Skeleton className="ez-skeleton-pill mt-4" />
          <Skeleton className="ez-skeleton-line ez-skeleton-line-sm mt-5" />
        </div>
      ))}
    </div>
  )
}

function BillingPanelSkeleton() {
  return (
    <div className="billing-panel-skeleton" aria-label="Loading billing" role="status">
      <div className="billing-panel-skeleton-top">
        <div className="billing-panel-skeleton-plan dashboard-card">
          <Skeleton className="ez-skeleton-pill" />
          <Skeleton className="ez-skeleton-line ez-skeleton-line-lg mt-4" />
          <Skeleton className="ez-skeleton-line ez-skeleton-line-md mt-3" />
        </div>
        <div className="billing-panel-skeleton-plan dashboard-card">
          <Skeleton className="ez-skeleton-line ez-skeleton-line-sm" />
          <Skeleton className="ez-skeleton-line ez-skeleton-line-lg mt-3" />
        </div>
      </div>
      <div className="billing-panel-skeleton-metrics">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="billing-panel-skeleton-metric dashboard-card" />
        ))}
      </div>
    </div>
  )
}

function CandidateSidebarSkeleton({ count = 5 }) {
  return (
    <div className="candidate-sidebar-skeleton" aria-label="Loading candidates" role="status">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="candidate-sidebar-skeleton-item">
          <Skeleton className="ez-skeleton-circle-sm" />
          <div className="flex-1 min-w-0 space-y-2">
            <Skeleton className="ez-skeleton-line ez-skeleton-line-md" />
            <Skeleton className="ez-skeleton-line ez-skeleton-line-sm" />
            <Skeleton className="ez-skeleton-pill ez-skeleton-line-xs" />
          </div>
        </div>
      ))}
    </div>
  )
}

function CandidateDetailSkeleton({ className = '' }) {
  return (
    <div className={`candidate-detail-skeleton ${className}`} aria-label="Loading candidate profile" role="status">
      <div className="candidate-detail-skeleton-panel modern-panel">
        <div className="flex items-center gap-4">
          <Skeleton className="ez-skeleton-circle" />
          <div className="flex-1 space-y-2">
            <Skeleton className="ez-skeleton-line ez-skeleton-line-lg" />
            <Skeleton className="ez-skeleton-line ez-skeleton-line-md" />
          </div>
        </div>
      </div>
      <div className="candidate-detail-skeleton-panel modern-panel">
        <Skeleton className="ez-skeleton-line ez-skeleton-line-sm mb-4" />
        <Skeleton className="ez-skeleton-line ez-skeleton-track mb-2" />
        <Skeleton className="ez-skeleton-line ez-skeleton-track mb-2" />
        <Skeleton className="ez-skeleton-line ez-skeleton-line-md" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="candidate-detail-skeleton-panel modern-panel min-h-[12rem]" />
        <div className="candidate-detail-skeleton-panel modern-panel min-h-[12rem]" />
      </div>
    </div>
  )
}

function CandidatesLoadingState({ className = '' }) {
  return (
    <div className={`candidates-loading-state flex flex-col items-center justify-center text-center ${className}`}>
      <p className="type-card-title theme-heading">AI scoring candidates…</p>
      <p className="type-body theme-muted mt-2 max-w-sm">
        Matches will appear in the list as they are found and ranked.
      </p>
      <div className="gmail-scan-dots flex items-center gap-1.5 mt-6" aria-hidden="true">
        <span className="gmail-scan-dot" />
        <span className="gmail-scan-dot gmail-scan-dot-2" />
        <span className="gmail-scan-dot gmail-scan-dot-3" />
      </div>
    </div>
  )
}

const JOB_SCAN_MESSAGES = [
  'Scanning Gmail inbox...',
  'Reading application emails...',
  'Parsing CV attachments...',
  'AI scoring candidates...',
  'Matching profiles to job description...',
]

function JobLiveScanStatus({ message }) {
  return (
    <div className="job-scan-live mt-3" aria-live="polite">
      <span className="job-scan-live-dot" aria-hidden="true" />
      <span key={message} className="job-scan-live-text type-caption">
        {message}
      </span>
    </div>
  )
}

function useLiveJobScan(active, baseScanned, baseNewFound) {
  const [liveScanned, setLiveScanned] = useState(baseScanned)
  const [liveNewFound, setLiveNewFound] = useState(baseNewFound)
  const [messageIndex, setMessageIndex] = useState(0)

  useEffect(() => {
    if (!active) {
      setLiveScanned(baseScanned)
      setLiveNewFound(baseNewFound)
      setMessageIndex(0)
      return
    }

    const messageInterval = setInterval(() => {
      setMessageIndex((i) => (i + 1) % JOB_SCAN_MESSAGES.length)
    }, 2400)

    const countInterval = setInterval(() => {
      setLiveScanned((c) => (c >= baseScanned + 5 ? baseScanned : c + 1))
      setLiveNewFound((c) => {
        if (c >= baseNewFound + 1) return baseNewFound
        return Math.random() > 0.4 ? c + 1 : c
      })
    }, 2800)

    return () => {
      clearInterval(messageInterval)
      clearInterval(countInterval)
    }
  }, [active, baseScanned, baseNewFound])

  return {
    liveScanned,
    liveNewFound,
    scanMessage: JOB_SCAN_MESSAGES[messageIndex],
  }
}

function CreateJobGuideIcon() {
  return (
    <div className="create-job-guide">
      <span className="create-job-hint-pill type-caption" aria-hidden="true">Tap to create</span>
      <span className="create-job-pulse-ring" aria-hidden="true" />
      <span className="create-job-pulse-ring create-job-pulse-ring-2" aria-hidden="true" />
      <div className="create-job-orbit" aria-hidden="true">
        <span className="create-job-orbit-arm create-job-orbit-arm-1">
          <span className="create-job-orbit-dot" />
        </span>
        <span className="create-job-orbit-arm create-job-orbit-arm-2">
          <span className="create-job-orbit-dot" />
        </span>
        <span className="create-job-orbit-arm create-job-orbit-arm-3">
          <span className="create-job-orbit-dot" />
        </span>
      </div>
      <div className="dashboard-create-icon create-job-icon-cta w-14 h-14 rounded-full flex items-center justify-center">
        <FaIcon icon="plus" size={24} className="text-ez-accent" />
      </div>
      <span className="create-job-tap-cursor" aria-hidden="true">
        <FaIcon icon="hand-pointer" size={17} />
      </span>
    </div>
  )
}

function JobStatusBadge({ status = 'active' }) {
  if (status === 'paused') {
    return (
      <span className="type-badge font-semibold px-3 py-1 rounded-full flex-shrink-0 inline-flex items-center gap-1.5 bg-[#fef3c7] text-[#92400e]">
        Auto scan pause
      </span>
    )
  }
  if (status === 'closed') {
    return (
      <span className="type-badge font-semibold px-3 py-1 rounded-full flex-shrink-0 inline-flex items-center gap-1.5 bg-[#f3f4f6] text-[#6b7280]">
        Closed
      </span>
    )
  }
  return (
    <span className="type-badge font-semibold px-3 py-1 rounded-full flex-shrink-0 inline-flex items-center gap-1.5 requirement-badge-active">
      <span className="requirement-badge-dot w-1.5 h-1.5 rounded-full animate-pulse-dot" aria-hidden="true" />
      Auto scan active
    </span>
  )
}

function EditJobModal({
  open,
  fields,
  scanFromDate,
  scanToDate,
  errors,
  saving,
  onFieldsChange,
  onScanDatesChange,
  onSave,
  onClose,
}) {
  if (!open) return null

  return (
    <div className="scan-modal-overlay fixed inset-0 z-50 flex items-center justify-center p-6" role="dialog" aria-modal="true" aria-labelledby="edit-job-title">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close" onClick={onClose} />
      <div className="scan-modal relative w-full max-w-2xl rounded-3xl p-8 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 id="edit-job-title" className="type-section theme-heading">Edit job</h2>
          <button type="button" onClick={onClose} className="candidate-drawer-close" aria-label="Close">
            <FaIcon icon="xmark" size={16} />
          </button>
        </div>

        <label className="type-label theme-muted mb-1.5 block">Job Title</label>
        <input
          type="text"
          value={fields.title}
          onChange={(e) => onFieldsChange({ ...fields, title: e.target.value })}
          className="theme-input type-input border rounded-xl px-4 py-3 w-full focus:outline-none focus:ring-2 focus:ring-[#2d6a84] focus:border-transparent mb-4"
        />

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="type-label theme-muted mb-1.5 block">Min experience (years)</label>
            <input
              type="number"
              min="0"
              value={fields.expMin}
              onChange={(e) => onFieldsChange({ ...fields, expMin: e.target.value })}
              className="theme-input type-input border rounded-xl px-4 py-3 w-full focus:outline-none focus:ring-2 focus:ring-[#2d6a84] focus:border-transparent"
            />
          </div>
          <div>
            <label className="type-label theme-muted mb-1.5 block">Max experience (years)</label>
            <input
              type="number"
              min="0"
              value={fields.expMax}
              onChange={(e) => onFieldsChange({ ...fields, expMax: e.target.value })}
              className="theme-input type-input border rounded-xl px-4 py-3 w-full focus:outline-none focus:ring-2 focus:ring-[#2d6a84] focus:border-transparent"
            />
            {errors.experience && <p className="type-caption text-[#e8824a] mt-1">{errors.experience}</p>}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="type-label theme-muted mb-1.5 block">Education</label>
            <input
              type="text"
              value={fields.education}
              onChange={(e) => onFieldsChange({ ...fields, education: e.target.value })}
              placeholder="e.g. B.Tech CS"
              className="theme-input type-input border rounded-xl px-4 py-3 w-full focus:outline-none focus:ring-2 focus:ring-[#2d6a84] focus:border-transparent"
            />
          </div>
          <div>
            <label className="type-label theme-muted mb-1.5 block">Current location</label>
            <input
              type="text"
              value={fields.location}
              onChange={(e) => onFieldsChange({ ...fields, location: e.target.value })}
              placeholder="e.g. Bangalore"
              className="theme-input type-input border rounded-xl px-4 py-3 w-full focus:outline-none focus:ring-2 focus:ring-[#2d6a84] focus:border-transparent"
            />
          </div>
        </div>

        <label className="type-label theme-muted mb-1.5 block">Primary skills</label>
        <input
          type="text"
          value={fields.primarySkillsText}
          onChange={(e) => onFieldsChange({ ...fields, primarySkillsText: e.target.value })}
          placeholder="e.g. React, TypeScript, Node.js"
          className="theme-input type-input border rounded-xl px-4 py-3 w-full focus:outline-none focus:ring-2 focus:ring-[#2d6a84] focus:border-transparent mb-1"
        />
        <p className="type-caption theme-muted mb-4">Separate skills with commas</p>

        <label className="type-label theme-muted mb-1.5 block">Secondary skills</label>
        <input
          type="text"
          value={fields.secondarySkillsText}
          onChange={(e) => onFieldsChange({ ...fields, secondarySkillsText: e.target.value })}
          placeholder="e.g. PostgreSQL, AWS"
          className="theme-input type-input border rounded-xl px-4 py-3 w-full focus:outline-none focus:ring-2 focus:ring-[#2d6a84] focus:border-transparent mb-1"
        />
        <p className="type-caption theme-muted mb-4">Optional nice-to-have skills, comma-separated</p>

        <ScanDateRangeField
          from={scanFromDate}
          to={scanToDate}
          onChange={onScanDatesChange}
          error={errors.scanDates}
        />

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="dashboard-outline-btn type-button rounded-xl py-2.5 px-5 flex-1"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || !fields.title.trim()}
            onClick={onSave}
            className={`type-button flex-1 rounded-xl py-2.5 px-5 ${fields.title.trim() && !saving ? 'bg-[#2d6a84] hover:bg-[#235470] text-white' : 'bg-[#c8dce6] text-white cursor-not-allowed opacity-60'}`}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

function JobCardActionsMenu({
  job,
  scanning,
  onScanNow,
  onPause,
  onResume,
  onClose,
  onReopen,
  onEdit,
  onDelete,
}) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef(null)
  const status = job.status || 'active'
  const isClosed = status === 'closed'

  useEffect(() => {
    if (!open) return undefined
    const handlePointerDown = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [open])

  const run = (action) => {
    setOpen(false)
    action?.()
  }

  return (
    <div className="job-card-menu" ref={menuRef}>
      <button
        type="button"
        className="job-card-menu-trigger"
        onClick={() => setOpen((visible) => !visible)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Job actions"
      >
        <FaIcon icon="ellipsis-vertical" size={14} />
      </button>

      {open && (
        <div className="job-card-menu-dropdown" role="menu">
          <button type="button" role="menuitem" className="job-card-menu-item" onClick={() => run(onEdit)}>
            <FaIcon icon="pen" size={12} /> Edit
          </button>
          <button
            type="button"
            role="menuitem"
            className="job-card-menu-item"
            disabled={isClosed || scanning}
            onClick={() => run(onScanNow)}
          >
            <FaIcon icon={scanning ? 'spinner' : 'bolt'} size={12} className={scanning ? 'fa-spin' : ''} />
            {scanning ? 'Scanning…' : 'Quick scan'}
          </button>
          {status === 'active' && (
            <button type="button" role="menuitem" className="job-card-menu-item" onClick={() => run(onPause)}>
              <FaIcon icon="pause" size={12} /> Pause auto scan
            </button>
          )}
          {status === 'paused' && (
            <button type="button" role="menuitem" className="job-card-menu-item" onClick={() => run(onResume)}>
              <FaIcon icon="play" size={12} /> Resume auto scan
            </button>
          )}
          {!isClosed ? (
            <button type="button" role="menuitem" className="job-card-menu-item" onClick={() => run(onClose)}>
              <FaIcon icon="circle-pause" size={12} /> Inactive
            </button>
          ) : (
            <button type="button" role="menuitem" className="job-card-menu-item" onClick={() => run(onReopen)}>
              <FaIcon icon="rotate-left" size={12} /> Reopen
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="job-card-menu-item job-card-menu-item-danger"
            onClick={() => run(onDelete)}
          >
            <FaIcon icon="trash" size={12} /> Delete
          </button>
        </div>
      )}
    </div>
  )
}

function JobPortfolioCardMockup() {
  return (
    <div className="dashboard-card job-portfolio-card job-portfolio-card-mockup rounded-2xl p-6" aria-hidden="true">
      <div className="job-portfolio-mockup-body">
        <span className="job-portfolio-mockup-icon" aria-hidden="true">
          <FaIcon icon="briefcase" size={22} />
        </span>
        <p className="job-portfolio-mockup-banner type-body">
          Your job portfolio will appear here
        </p>
        <p className="job-portfolio-mockup-hint type-caption theme-muted">
          Create a job to fill this slot
        </p>
      </div>
    </div>
  )
}

const JOB_PORTFOLIO_MOCKUP_SLOTS = 2

function JobPortfolioCard({
  job,
  scanning,
  onScanNow,
  onPause,
  onResume,
  onClose,
  onReopen,
  onEdit,
  onDelete,
  onReview,
}) {
  const status = job.status || 'active'
  const locationLabel = job.location || `${job.exp_min}-${job.exp_max} yrs`
  const isQuickScanning = scanning
  const isAutoScanActive = status === 'active'
  const showScanAnimation = isQuickScanning || isAutoScanActive
  const scanStatusMessage = isQuickScanning
    ? 'Quick scanning is in progress'
    : 'Auto-scanning in every 15 min…'

  return (
    <div className={`dashboard-card job-portfolio-card rounded-2xl p-6 ${showScanAnimation ? 'dashboard-card-scanning' : ''}`}>
      <div className="flex justify-between items-start gap-3">
        <JobStatusBadge status={status} />
        <JobCardActionsMenu
          job={job}
          scanning={scanning}
          onScanNow={onScanNow}
          onPause={onPause}
          onResume={onResume}
          onClose={onClose}
          onReopen={onReopen}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </div>
      <h3 className="type-card-title theme-heading mt-3">{job.title}</h3>
      <p className="type-body theme-muted flex items-center gap-1 mt-1">
        <FaIcon icon="location-dot" size={13} /> {locationLabel}
      </p>
      <JobPortfolioMetrics
        totalScanned={job.total_scanned ?? 0}
        topMatches={job.top_matches ?? 0}
        newFound={job.new_found ?? 0}
        shortlisted={job.shortlisted ?? 0}
        inProgress={job.in_progress ?? 0}
        scanning={showScanAnimation}
      />
      {showScanAnimation && <JobLiveScanStatus message={scanStatusMessage} />}

      <button
        type="button"
        onClick={onReview}
        className="type-button mt-4 bg-[#2d6a84] hover:bg-[#235470] text-white rounded-xl py-3 px-6 w-full"
      >
        Review Candidates →
      </button>
    </div>
  )
}

function JobPortfolioMetrics({ totalScanned, topMatches, newFound, shortlisted, inProgress, scanning = false }) {
  const metrics = [
    { label: 'Total Scanned', value: totalScanned, tone: 'neutral', live: true },
    { label: 'Top Matches', value: topMatches, tone: 'teal', live: false },
    { label: 'New Found', value: newFound, tone: 'blue', live: true },
    { label: 'Shortlisted', value: shortlisted, tone: 'green', live: false },
    { label: 'In Progress', value: inProgress, tone: 'amber', live: false },
  ]

  return (
    <div className={`portfolio-metrics mt-5 ${scanning ? 'portfolio-metrics-scanning' : ''}`}>
      {scanning && <span className="portfolio-metrics-shimmer" aria-hidden="true" />}
      <div className="portfolio-metrics-row portfolio-metrics-row-top">
        {metrics.slice(0, 3).map((m) => (
          <div
            key={m.label}
            className={`portfolio-metric-cell portfolio-metric-cell-${m.tone} ${scanning && m.live ? 'portfolio-metric-cell-live' : ''}`}
          >
            <p className="portfolio-metric-label">{m.label}</p>
            <p key={m.value} className={`portfolio-metric-value ${scanning && m.live ? 'portfolio-metric-value-tick' : ''}`}>
              {m.value}
            </p>
          </div>
        ))}
      </div>
      <div className="portfolio-metrics-row portfolio-metrics-row-bottom">
        {metrics.slice(3).map((m) => (
          <div key={m.label} className={`portfolio-metric-cell portfolio-metric-cell-${m.tone}`}>
            <p className="portfolio-metric-label">{m.label}</p>
            <p className="portfolio-metric-value">{m.value}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

const CHAT_QUICK_ACTIONS = [
  { label: 'Find React developers', icon: 'code', query: 'React developers in Bangalore' },
  { label: 'Top scored candidates', icon: 'ranking-star', query: 'Top 3 candidates by score' },
  { label: 'Shortlisted pipeline', icon: 'filter', query: 'Show shortlisted candidates' },
]

const CHAT_DEFAULT_RECENTS = [
  'React developers in Bangalore',
  'Top 3 candidates by score',
  'Show shortlisted candidates',
]

function getRecentChatMeta(title) {
  const action = CHAT_QUICK_ACTIONS.find((item) => item.query === title)
  if (!action) {
    return { icon: 'clock-rotate-left', tone: 'blue' }
  }
  return {
    icon: action.icon,
    tone: action.icon === 'ranking-star' ? 'orange' : 'blue',
  }
}

function stripHtml(html = '') {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function formatDraftRecipients(recipients) {
  if (!recipients?.length) return 'No recipients'
  if (recipients.length === 1) {
    const recipient = recipients[0]
    if (typeof recipient === 'string') return recipient
    return recipient.name || recipient.email || '1 recipient'
  }
  const names = recipients.slice(0, 3).map((recipient) => {
    if (typeof recipient === 'string') return recipient
    return recipient.name || recipient.email || 'Recipient'
  })
  const suffix = recipients.length > 3 ? ` +${recipients.length - 3} more` : ''
  return `${names.join(', ')}${suffix}`
}

function renderChatInlineText(text) {
  const parts = String(text).split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={`bold-${index}`} className="chat-message-strong">
          {part.slice(2, -2)}
        </strong>
      )
    }
    return part
  })
}

function ChatMessageContent({ content }) {
  if (!content) return null

  const lines = String(content).split('\n')
  const nodes = []
  let listBuffer = []
  let paraBuffer = []

  const flushList = () => {
    if (listBuffer.length === 0) return
    nodes.push(
      <ul key={`list-${nodes.length}`} className="chat-message-list">
        {listBuffer.map((line, index) => (
          <li key={`item-${index}`}>{renderChatInlineText(line)}</li>
        ))}
      </ul>,
    )
    listBuffer = []
  }

  const flushParagraph = () => {
    const text = paraBuffer.join('\n').trim()
    if (!text) {
      paraBuffer = []
      return
    }
    nodes.push(
      <p key={`para-${nodes.length}`} className="chat-message-paragraph type-body">
        {text.split('\n').map((line, index) => (
          <span key={`line-${index}`}>
            {index > 0 && <br />}
            {renderChatInlineText(line)}
          </span>
        ))}
      </p>,
    )
    paraBuffer = []
  }

  lines.forEach((line) => {
    const trimmed = line.trim()
    if (!trimmed) {
      flushList()
      flushParagraph()
      return
    }
    if (trimmed.startsWith('- ')) {
      flushParagraph()
      listBuffer.push(trimmed.slice(2))
      return
    }
    flushList()
    paraBuffer.push(line)
  })

  flushList()
  flushParagraph()

  return <div className="chat-message-content">{nodes}</div>
}

function AssistantVoiceControl({ messageId, content, activeMessageId, isPlaying, onToggle }) {
  const isActive = activeMessageId === messageId
  const showPause = isActive && isPlaying

  return (
    <button
      type="button"
      className={`chat-voice-control${showPause ? ' chat-voice-control-active' : ''}`}
      onClick={() => onToggle(messageId, content)}
      aria-label={showPause ? 'Pause voice reply' : 'Play voice reply'}
      aria-pressed={showPause}
    >
      <FaIcon icon={showPause ? 'pause' : 'play'} size={11} />
      <span>{showPause ? 'Pause' : 'Listen'}</span>
    </button>
  )
}

function SearchResultCard({ candidate, onClick, variant = 'exact', filtersUsed, portfolioCandidates = [] }) {
  const displayName = candidate.name || 'Unknown candidate'
  const score = candidate.match_percentage ?? 0
  const scoreTone = score >= 90 ? 'high' : score >= 75 ? 'mid' : 'low'
  const { email, phone } = enrichSearchCandidateContact(candidate, portfolioCandidates)
  const matchingSkills = getSearchCandidateMatchingSkills(candidate, filtersUsed)

  const interactiveProps = onClick
    ? {
      role: 'button',
      tabIndex: 0,
      onClick,
      onKeyDown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      },
      'aria-label': `View profile for ${displayName}`,
    }
    : {}

  return (
    <article
      className={`search-result-card search-result-card-${variant}${onClick ? ' search-result-card-clickable' : ''}`}
      {...interactiveProps}
    >
      <div className="search-result-card-accent" aria-hidden="true" />
      <div className="search-result-card-inner">
        <div className="search-result-avatar" aria-hidden="true">
          {getInitials(displayName)}
        </div>

        <div className="search-result-main">
          <div className="search-result-top">
            <div className="search-result-identity min-w-0">
              <p className="search-result-name theme-heading">{displayName}</p>
              <div className="search-result-chips">
                {candidate.location && (
                  <span className="search-result-chip">
                    <FaIcon icon="location-dot" size={10} />
                    <span>{candidate.location}</span>
                  </span>
                )}
                {candidate.total_exp_years != null && (
                  <span className="search-result-chip">
                    <FaIcon icon="briefcase" size={10} />
                    <span>{candidate.total_exp_years} yrs</span>
                  </span>
                )}
              </div>
            </div>

            <div className={`search-result-match search-result-match-${scoreTone}`} aria-label={`${score}% match`}>
              <span className="search-result-match-ring" style={{ '--match-pct': score }} />
              <span className="search-result-match-value">{score}%</span>
            </div>
          </div>

          <div className="search-result-details">
              <div className="search-result-contact">
                <span className={`search-result-detail-item${phone ? '' : ' search-result-detail-item-muted'}`}>
                  <FaIcon icon="phone" size={10} />
                  <span>{phone || 'Phone not available'}</span>
                </span>
                <span className={`search-result-detail-item${email ? '' : ' search-result-detail-item-muted'}`}>
                  <FaIcon icon="envelope" size={10} />
                  <span className="truncate">{email || 'Email not available'}</span>
                </span>
              </div>
              {matchingSkills.length > 0 && (
                <div className="search-result-skills">
                  {matchingSkills.map((skill) => (
                    <span key={skill} className="search-result-skill-chip">{skill}</span>
                  ))}
                </div>
              )}
            </div>
        </div>

        {onClick && (
          <span className="search-result-chevron" aria-hidden="true">
            <FaIcon icon="chevron-right" size={12} />
          </span>
        )}
      </div>
    </article>
  )
}

function SearchResultsSections({ results, onCandidateSelect, portfolioCandidates = [] }) {
  if (!results) return null

  const sections = [
    { key: 'exact', label: 'Exact matches', items: results.exact_matches || [] },
    { key: 'strong', label: 'Strong matches', items: results.strong_matches || [] },
    { key: 'below', label: 'Below threshold', items: results.below_threshold || [] },
  ].filter((section) => section.items.length > 0)

  if (sections.length === 0) {
    if (!results.message) return null
    return (
      <div className="search-results-sections mt-4">
        <p className="search-results-summary type-caption theme-muted">
          {renderChatInlineText(results.message)}
        </p>
      </div>
    )
  }

  return (
    <div className="search-results-sections mt-4 space-y-4">
      {results.message && (
        <p className="search-results-summary type-caption theme-muted">
          {renderChatInlineText(results.message)}
        </p>
      )}
      {sections.map((section) => (
        <section key={section.key} className="search-results-group">
          <h4 className="search-results-group-title type-label theme-heading">{section.label}</h4>
          <div className="search-results-group-list space-y-2">
            {section.items.map((candidate, index) => (
              <SearchResultCard
                key={candidate.cv_document_id || `${section.key}-${index}`}
                candidate={candidate}
                variant={section.key}
                filtersUsed={results.filters_used}
                portfolioCandidates={portfolioCandidates}
                onClick={onCandidateSelect
                  ? () => onCandidateSelect(candidate, results.filters_used)
                  : undefined}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function AgentDraftCard({
  draft,
  status = 'pending',
  result,
  loading,
  onConfirm,
  onCancel,
}) {
  if (status === 'confirmed') {
    const sent = result?.sent ?? 0
    const failed = result?.failed ?? 0
    return (
      <div className="agent-draft-card agent-draft-card-confirmed" role="status">
        <FaIcon icon="circle-check" size={16} />
        <span>
          Sent to {sent} candidate{sent === 1 ? '' : 's'}
          {failed > 0 ? ` (${failed} failed)` : ''}
        </span>
      </div>
    )
  }

  if (status === 'cancelled') {
    return (
      <div className="agent-draft-card agent-draft-card-cancelled" role="status">
        <FaIcon icon="ban" size={14} />
        <span>Draft cancelled</span>
      </div>
    )
  }

  const preview = stripHtml(draft.body_html)
  const previewText = preview.length > 220 ? `${preview.slice(0, 220)}…` : preview

  return (
    <div className="agent-draft-card" role="region" aria-label="Email draft awaiting confirmation">
      <div className="agent-draft-card-badge">
        <FaIcon icon="envelope" size={12} />
        Draft email — confirm to send
      </div>
      <p className="agent-draft-subject theme-heading">{draft.subject}</p>
      <p className="agent-draft-meta type-caption theme-muted">
        To: {formatDraftRecipients(draft.recipients)}
      </p>
      {previewText && (
        <p className="agent-draft-preview type-caption theme-muted">{previewText}</p>
      )}
      <div className="agent-draft-actions">
        <button
          type="button"
          className="agent-draft-btn agent-draft-btn-cancel type-caption"
          onClick={onCancel}
          disabled={loading}
        >
          Cancel
        </button>
        <button
          type="button"
          className="agent-draft-btn agent-draft-btn-confirm type-button"
          onClick={onConfirm}
          disabled={loading}
        >
          {loading ? 'Sending…' : 'Confirm & send'}
        </button>
      </div>
    </div>
  )
}

function VoiceOrbVisual() {
  return (
    <div className="voice-orb-scene" aria-hidden="true">
      <div className="voice-orb-ring voice-orb-ring-outer" />
      <div className="voice-orb-ring voice-orb-ring-inner" />
      <div className="voice-orb-core">
        <div className="voice-orb-blob voice-orb-blob-1" />
        <div className="voice-orb-blob voice-orb-blob-2" />
        <div className="voice-orb-blob voice-orb-blob-3" />
        <div className="voice-orb-blob voice-orb-blob-4" />
      </div>
    </div>
  )
}

function CandidateChatbot({
  candidates,
  job,
  onSaveNote,
  onUpdateStage,
  onResumeError,
  theme,
  onThemeChange,
  onClose,
}) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [isThinking, setIsThinking] = useState(false)
  const [chatHistoryOpen, setChatHistoryOpen] = useState(false)
  const [recentChats, setRecentChats] = useState(CHAT_DEFAULT_RECENTS)
  const [drawerCandidate, setDrawerCandidate] = useState(null)
  const [chatResumeOpen, setChatResumeOpen] = useState(false)
  const [voiceListening, setVoiceListening] = useState(false)
  const [conversationId, setConversationId] = useState(null)
  const [draftActionLoading, setDraftActionLoading] = useState(false)
  const [chatError, setChatError] = useState(null)
  const [voiceMessageId, setVoiceMessageId] = useState(null)
  const [voicePlaying, setVoicePlaying] = useState(false)
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)
  const speechRecognitionRef = useRef(null)
  const speakingAudioRef = useRef(null)
  const voiceMessageIdRef = useRef(null)

  const hasConversation = messages.length > 0

  const handleSearchCandidateSelect = useCallback((searchCandidate, filtersUsed) => {
    setDrawerCandidate(mapSearchCandidateToUi(searchCandidate, filtersUsed))
  }, [])

  const latestPendingDraftMessageId = messages.reduce((foundId, msg) => {
    if (msg.role === 'assistant' && msg.draft && msg.draftStatus === 'pending') {
      return msg.id
    }
    return foundId
  }, null)

  const shouldShowDraft = (msg) => {
    if (!msg.draft) return false
    if (msg.draftStatus !== 'pending') return true
    return msg.id === latestPendingDraftMessageId
  }

  const stopSpeaking = useCallback(() => {
    if (speakingAudioRef.current) {
      speakingAudioRef.current.pause()
      speakingAudioRef.current = null
    }
    voiceMessageIdRef.current = null
    setVoiceMessageId(null)
    setVoicePlaying(false)
  }, [])

  const playMessageVoice = useCallback(async (messageId, text) => {
    const trimmed = text?.trim()
    if (!trimmed) return

    const currentAudio = speakingAudioRef.current
    if (voiceMessageIdRef.current === messageId && currentAudio) {
      if (!currentAudio.paused) {
        currentAudio.pause()
        setVoicePlaying(false)
      } else {
        try {
          await currentAudio.play()
          setVoicePlaying(true)
        } catch {
          setVoicePlaying(false)
        }
      }
      return
    }

    if (currentAudio) {
      currentAudio.pause()
      speakingAudioRef.current = null
    }

    voiceMessageIdRef.current = messageId
    setVoiceMessageId(messageId)
    setVoicePlaying(false)

    try {
      const audio = await speak(trimmed)
      speakingAudioRef.current = audio

      const handleEnded = () => {
        if (speakingAudioRef.current !== audio) return
        speakingAudioRef.current = null
        voiceMessageIdRef.current = null
        setVoiceMessageId(null)
        setVoicePlaying(false)
      }

      audio.addEventListener('ended', handleEnded, { once: true })
      audio.addEventListener('pause', () => {
        if (speakingAudioRef.current === audio && audio.paused && !audio.ended) {
          setVoicePlaying(false)
        }
      })

      await audio.play()
      setVoicePlaying(true)
    } catch {
      speakingAudioRef.current = null
      voiceMessageIdRef.current = null
      setVoiceMessageId(null)
      setVoicePlaying(false)
    }
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isThinking])

  useEffect(() => () => {
    stopSpeaking()
    speechRecognitionRef.current?.stop?.()
  }, [stopSpeaking])

  // Drop any legacy persisted conversation id from older builds.
  useEffect(() => {
    try {
      localStorage.removeItem('inboxhire_agent_conversation_id')
    } catch {
      /* ignore */
    }
  }, [])

  const sendQuery = useCallback(async (text) => {
    const trimmed = text.trim()
    if (!trimmed || isThinking) return

    setChatError(null)
    const userMsg = { id: `u-${Date.now()}`, role: 'user', content: trimmed }
    const continueConversationId = messages.length > 0 ? conversationId : null
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setRecentChats((prev) => [trimmed, ...prev.filter((item) => item !== trimmed)].slice(0, 8))
    setIsThinking(true)

    try {
      const [agentResult, searchResult] = await Promise.allSettled([
        agentChat(trimmed, continueConversationId),
        searchCandidates(trimmed),
      ])

      if (agentResult.status === 'rejected') {
        throw agentResult.reason
      }

      const response = agentResult.value
      setConversationId(response.conversation_id)

      const assistantMsgId = `a-${Date.now()}`
      setMessages((prev) => [
        ...prev,
        {
          id: assistantMsgId,
          role: 'assistant',
          content: response.reply,
          draft: response.pending_draft,
          draftStatus: response.pending_draft ? 'pending' : undefined,
          searchResults: searchResult.status === 'fulfilled' ? searchResult.value : null,
        },
      ])

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong. Please try again.'
      setChatError(message)
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: message,
        },
      ])
    } finally {
      setIsThinking(false)
    }
  }, [conversationId, isThinking, messages.length])

  const handleDraftConfirm = async (messageId, draftId) => {
    setDraftActionLoading(true)
    try {
      const result = await confirmDraft(draftId)
      setMessages((prev) => prev.map((msg) => (
        msg.id === messageId
          ? { ...msg, draftStatus: 'confirmed', draftResult: result }
          : msg
      )))
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Could not send draft')
    } finally {
      setDraftActionLoading(false)
    }
  }

  const handleDraftCancel = async (messageId, draftId) => {
    setDraftActionLoading(true)
    try {
      await cancelDraft(draftId)
      setMessages((prev) => prev.map((msg) => (
        msg.id === messageId
          ? { ...msg, draftStatus: 'cancelled' }
          : msg
      )))
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Could not cancel draft')
    } finally {
      setDraftActionLoading(false)
    }
  }

  const handleNewChat = () => {
    stopSpeaking()
    setMessages([])
    setInput('')
    setConversationId(null)
    setChatError(null)
    setChatHistoryOpen(false)
    inputRef.current?.focus()
  }

  const handleRecentSelect = (title) => {
    sendQuery(title)
    setChatHistoryOpen(false)
  }

  const renderRecentChatList = (onSelect = handleRecentSelect) => (
    recentChats.map((title) => {
      const meta = getRecentChatMeta(title)
      return (
        <button
          key={title}
          type="button"
          onClick={() => onSelect(title)}
          className="chatgpt-sidebar-item"
          title={title}
          aria-label={title}
        >
          <span className={`chatgpt-sidebar-item-icon chatgpt-sidebar-item-icon-${meta.tone}`}>
            <FaIcon icon={meta.icon} size={12} />
          </span>
          <span className="chatgpt-sidebar-item-text type-caption">{title}</span>
        </button>
      )
    })
  )

  useEffect(() => {
    if (!chatHistoryOpen) return undefined
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setChatHistoryOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [chatHistoryOpen])

  useEffect(() => {
    if (!voiceListening) {
      speechRecognitionRef.current?.stop?.()
      speechRecognitionRef.current = null
      return undefined
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      setVoiceListening(false)
      setChatError('Voice input is not supported in this browser.')
      return undefined
    }

    const recognition = new SpeechRecognition()
    recognition.lang = 'en-IN'
    recognition.continuous = false
    recognition.interimResults = true
    speechRecognitionRef.current = recognition

    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript || '')
        .join('')
        .trim()
      setInput(transcript)

      const lastResult = event.results[event.results.length - 1]
      if (lastResult?.isFinal && transcript) {
        setVoiceListening(false)
        sendQuery(transcript)
      }
    }

    recognition.onerror = () => {
      setVoiceListening(false)
    }

    recognition.onend = () => {
      speechRecognitionRef.current = null
    }

    try {
      recognition.start()
    } catch {
      setVoiceListening(false)
      setChatError('Could not start voice input.')
    }

    const onKeyDown = (e) => {
      if (e.key === 'Escape') setVoiceListening(false)
    }
    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      recognition.stop()
      speechRecognitionRef.current = null
    }
  }, [voiceListening, sendQuery])

  const toggleVoiceListening = () => {
    setVoiceListening((prev) => !prev)
  }

  const renderVoiceListening = () => (
    <div className="chatgpt-voice-inline" role="status" aria-live="polite" aria-label="Listening">
      <VoiceOrbVisual />
      <span className="chatgpt-voice-inline-label">Listening...</span>
      <button
        type="button"
        onClick={toggleVoiceListening}
        className="chatgpt-voice-inline-mic chatgpt-composer-icon-btn chatgpt-composer-icon-btn-active"
        aria-label="Stop voice input"
        aria-pressed
      >
        <FaIcon icon="microphone" size={15} />
      </button>
    </div>
  )

  const renderComposer = (variant = 'bottom') => (
    <form
      className={`chatgpt-composer ${variant === 'hero' ? 'chatgpt-composer-hero' : 'chatgpt-composer-bottom'} ${voiceListening ? 'chatgpt-composer-listening' : ''}`}
      onSubmit={(e) => {
        e.preventDefault()
        sendQuery(input)
      }}
    >
      {!voiceListening && (
        <button type="button" className="chatgpt-composer-icon-btn" aria-label="Add attachment">
          <FaIcon icon="plus" size={15} />
        </button>
      )}
      {voiceListening && variant !== 'hero' ? (
        <div className="chatgpt-composer-voice" role="status" aria-live="polite" aria-label="Listening">
          <VoiceOrbVisual />
          <span className="chatgpt-composer-voice-label">Listening...</span>
        </div>
      ) : (
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              sendQuery(input)
            }
          }}
          rows={1}
          placeholder="Ask anything"
          className="chatgpt-composer-input focus:outline-none"
        />
      )}
      <div className="chatgpt-composer-actions">
        <button
          type="button"
          onClick={toggleVoiceListening}
          className={`chatgpt-composer-icon-btn ${voiceListening ? 'chatgpt-composer-icon-btn-active' : ''}`}
          aria-label={voiceListening ? 'Stop voice input' : 'Voice input'}
          aria-pressed={voiceListening}
        >
          <FaIcon icon="microphone" size={15} />
        </button>
        {!voiceListening && (
          <button
            type="submit"
            disabled={!input.trim() || isThinking}
            className="chatgpt-composer-send"
            aria-label="Send message"
          >
            <FaIcon icon="arrow-up" size={14} />
          </button>
        )}
      </div>
    </form>
  )

  return (
    <div className="chatgpt-shell">
      <aside className="chatgpt-sidebar chatgpt-sidebar-collapsed">
        <div className="chatgpt-sidebar-brand">
          <span className="chatgpt-sidebar-mark" aria-label="InboxHire">IH</span>
        </div>

        <div className="chatgpt-sidebar-body">
          <div className="chatgpt-sidebar-recents-block">
            <button type="button" onClick={handleNewChat} className="chatgpt-sidebar-new">
              <FaIcon icon="plus" size={13} />
              <span className="chatgpt-sidebar-new-label">New chat</span>
            </button>

            <button
              type="button"
              onClick={() => setChatHistoryOpen((prev) => !prev)}
              className={`chatgpt-sidebar-chats-btn ${chatHistoryOpen ? 'chatgpt-sidebar-chats-btn-active' : ''}`}
              aria-label={chatHistoryOpen ? 'Close chat list' : 'View all chats'}
              title={chatHistoryOpen ? 'Close chat list' : 'View all chats'}
            >
              <FaIcon icon="comments" size={14} />
            </button>
          </div>
        </div>
      </aside>

      {chatHistoryOpen && (
        <>
          <button
            type="button"
            className="chatgpt-history-backdrop"
            onClick={() => setChatHistoryOpen(false)}
            aria-label="Close chat list"
          />
          <div className="chatgpt-history-panel" role="dialog" aria-label="All chats">
            <div className="chatgpt-history-panel-head">
              <div>
                <p className="chatgpt-history-panel-title">Chats</p>
                <p className="chatgpt-history-panel-subtitle theme-muted type-caption">
                  {recentChats.length} recent searches
                </p>
              </div>
              <button
                type="button"
                onClick={() => setChatHistoryOpen(false)}
                className="chatgpt-history-panel-close"
                aria-label="Close chat list"
              >
                <FaIcon icon="xmark" size={14} />
              </button>
            </div>
            <button type="button" onClick={handleNewChat} className="chatgpt-sidebar-new chatgpt-history-panel-new">
              <FaIcon icon="plus" size={13} />
              <span className="chatgpt-sidebar-new-label">New chat</span>
            </button>
            <div className="chatgpt-history-panel-list">
              {renderRecentChatList()}
            </div>
          </div>
        </>
      )}

      <div className="chatgpt-main">
        <div className="chatgpt-ambient" aria-hidden="true">
          <div className="chatgpt-ambient-orb chatgpt-ambient-orb-blue" />
          <div className="chatgpt-ambient-orb chatgpt-ambient-orb-orange" />
        </div>

        <header className="chatgpt-topbar">
          <div className="chatgpt-topbar-actions">
            <ThemeSwitcher theme={theme} onChange={onThemeChange} />
            <button type="button" onClick={onClose} className="chatgpt-topbar-btn type-caption">
              <FaIcon icon="table-cells" size={14} />
              Dashboard
            </button>
          </div>
        </header>

        {!hasConversation ? (
          <div className={`chatgpt-home ${voiceListening ? 'chatgpt-home-listening' : ''}`}>
            {!voiceListening && (
              <div className="chatgpt-home-hero">
                <h1 className="chatgpt-home-title">What candidates are you looking for?</h1>
                <p className="chatgpt-home-subtitle theme-muted">
                  Ask in plain language - skills, location, score, or pipeline stage.
                </p>
              </div>
            )}
            {voiceListening ? renderVoiceListening() : renderComposer('hero')}
            {!voiceListening && (
              <div className="chatgpt-quick-actions">
                {CHAT_QUICK_ACTIONS.map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    onClick={() => sendQuery(action.query)}
                    className="chatgpt-quick-action type-caption"
                  >
                    <span className={`chatgpt-quick-action-icon chatgpt-quick-action-icon-${action.icon}`}>
                      <FaIcon icon={action.icon} size={13} />
                    </span>
                    <span className="chatgpt-quick-action-label">{action.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="chatgpt-thread">
              <div className="chatgpt-thread-inner">
                {chatError && (
                  <div className="chatgpt-chat-error type-caption" role="alert">
                    {chatError}
                  </div>
                )}
                {messages.map((msg) => (
                  <div key={msg.id} className={`chatgpt-turn chatgpt-turn-${msg.role}`}>
                    <div className="chatgpt-turn-content">
                      {msg.role === 'assistant' ? (
                        <>
                          <AssistantVoiceControl
                            messageId={msg.id}
                            content={msg.content}
                            activeMessageId={voiceMessageId}
                            isPlaying={voicePlaying}
                            onToggle={playMessageVoice}
                          />
                          <ChatMessageContent content={msg.content} />
                        </>
                      ) : (
                        <p className="type-body whitespace-pre-wrap">{msg.content}</p>
                      )}
                      {msg.searchResults && (
                        <SearchResultsSections
                          results={msg.searchResults}
                          onCandidateSelect={handleSearchCandidateSelect}
                          portfolioCandidates={candidates}
                        />
                      )}
                      {shouldShowDraft(msg) && (
                        <AgentDraftCard
                          draft={msg.draft}
                          status={msg.draftStatus}
                          result={msg.draftResult}
                          loading={draftActionLoading}
                          onConfirm={() => handleDraftConfirm(msg.id, msg.draft.id)}
                          onCancel={() => handleDraftCancel(msg.id, msg.draft.id)}
                        />
                      )}
                    </div>
                  </div>
                ))}

                {isThinking && (
                  <div className="chatgpt-turn chatgpt-turn-assistant">
                    <div className="chatgpt-turn-content chatgpt-thinking">
                      <span className="chatbot-dot" />
                      <span className="chatbot-dot chatbot-dot-2" />
                      <span className="chatbot-dot chatbot-dot-3" />
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>
            <div className="chatgpt-composer-wrap">
              {renderComposer('bottom')}
            </div>
          </>
        )}
      </div>

      <CandidateProfileDrawer
        open={!!drawerCandidate}
        candidate={drawerCandidate}
        job={job}
        onSaveNote={onSaveNote}
        onUpdateStage={onUpdateStage}
        onOpenResume={() => setChatResumeOpen(true)}
        onClose={() => {
          setDrawerCandidate(null)
          setChatResumeOpen(false)
        }}
      />

      <ResumePdfModal
        open={chatResumeOpen && !!drawerCandidate}
        applicationId={drawerCandidate?.applicationId || drawerCandidate?.id}
        candidateName={drawerCandidate?.name}
        matchPercent={drawerCandidate ? getCandidateMatchPercent(drawerCandidate) : null}
        highlightTerms={drawerCandidate?.highlightTerms || []}
        onClose={() => setChatResumeOpen(false)}
        onError={onResumeError}
      />
    </div>
  )
}

export default function App() {
  const [currentScreen, setCurrentScreen] = useState(getInitialAuthScreen)
  const [resetToken] = useState(() => getResetTokenFromUrl())
  const [signInMode, setSignInMode] = useState(getInitialSignInMode)
  const [selectedCandidate, setSelectedCandidate] = useState(null)
  const [showPassword, setShowPassword] = useState(false)
  const [signInEmail, setSignInEmail] = useState('')
  const [signInPassword, setSignInPassword] = useState('')
  const [signInLoading, setSignInLoading] = useState(false)
  const [authUserName, setAuthUserName] = useState(getAuthUserName)
  const [authRole, setAuthRoleState] = useState(resolveAuthRole)
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [changePasswordLoading, setChangePasswordLoading] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [extracted, setExtracted] = useState(false)
  const [scanOption, setScanOption] = useState(30)
  const [candidates, setCandidates] = useState([])
  const [jobDescription, setJobDescription] = useState(
    'We are looking for a Senior React Developer with 4-6 years of experience. Strong proficiency in React.js, TypeScript, Node.js required. PostgreSQL, AWS preferred. B.Tech CS or equivalent. Bangalore, remote friendly.'
  )
  const [extractedFields, setExtractedFields] = useState({ ...EMPTY_JOB_FORM })
  const [createJobView, setCreateJobView] = useState('source')
  const [availableSources, setAvailableSources] = useState({ gmail: [], drive: null, api: null })
  const [sourcesReady, setSourcesReady] = useState(false)
  const sourcesLoadRequestRef = useRef(0)
  const [chosenSourceType, setChosenSourceType] = useState(null)
  const [chosenGmailConnectionId, setChosenGmailConnectionId] = useState(null)
  const [gmailSourcePickerOpen, setGmailSourcePickerOpen] = useState(false)
  const [scanFromDate, setScanFromDate] = useState('')
  const [scanToDate, setScanToDate] = useState('')
  const [jobFormErrors, setJobFormErrors] = useState({})
  const [jobSubmitting, setJobSubmitting] = useState(false)
  const [scanningJobId, setScanningJobId] = useState(null)
  const [editJobOpen, setEditJobOpen] = useState(false)
  const [editJobId, setEditJobId] = useState(null)
  const [editJobFields, setEditJobFields] = useState({ ...EMPTY_JOB_FORM })
  const [editScanFromDate, setEditScanFromDate] = useState('')
  const [editScanToDate, setEditScanToDate] = useState('')
  const [editJobErrors, setEditJobErrors] = useState({})
  const [editJobSaving, setEditJobSaving] = useState(false)
  const [editJobSnapshot, setEditJobSnapshot] = useState(null)
  const [pendingCreateJobFlow, setPendingCreateJobFlow] = useState(false)
  const [dashboardJobs, setDashboardJobs] = useState([])
  const [activeJobId, setActiveJobId] = useState(null)
  const [candidatesLoading, setCandidatesLoading] = useState(false)
  const [showScanModal, setShowScanModal] = useState(false)
  const [gmailScanning, setGmailScanning] = useState(false)
  const [revealedCandidateIds, setRevealedCandidateIds] = useState([])
  const [scannedCvCount, setScannedCvCount] = useState(0)
  const jdFileInputRef = useRef(null)
  const scanTimersRef = useRef(null)
  const gmailOAuthPopupRef = useRef(null)
  const gmailPollAbortRef = useRef(null)
  const driveOAuthPopupRef = useRef(null)
  const drivePollAbortRef = useRef(null)
  const [seniorJobActive, setSeniorJobActive] = useState(true)
  const [pmJobActive, setPmJobActive] = useState(true)
  const [requirementPopup, setRequirementPopup] = useState(null)
  const [resumeViewerOpen, setResumeViewerOpen] = useState(false)
  const [emailSelectedIds, setEmailSelectedIds] = useState([])
  const [emailModalOpen, setEmailModalOpen] = useState(false)
  const [emailRecipientIds, setEmailRecipientIds] = useState([])
  const [emailSentNotice, setEmailSentNotice] = useState(null)
  const [oauthConnecting, setOauthConnecting] = useState(false)
  const [gmailConnectingConnectionId, setGmailConnectingConnectionId] = useState(null)
  const [assignInboxOpen, setAssignInboxOpen] = useState(false)
  const [assignInboxEmail, setAssignInboxEmail] = useState('')
  const [assignInboxLoading, setAssignInboxLoading] = useState(false)
  const [teamMembers, setTeamMembers] = useState([])
  const [selectedTeamMemberId, setSelectedTeamMemberId] = useState(null)
  const [pendingAssignConnectionId, setPendingAssignConnectionId] = useState(null)
  const [inboxToast, setInboxToast] = useState(null)
  const [paymentCelebration, setPaymentCelebration] = useState(null)
  const [upgradePlanOpen, setUpgradePlanOpen] = useState(false)
  const [selectedPlanId, setSelectedPlanId] = useState('starter')
  const [workspaceUsage, setWorkspaceUsage] = useState(DEFAULT_WORKSPACE_USAGE)
  const [billingPlans, setBillingPlans] = useState([])
  const [billingLoading, setBillingLoading] = useState(false)
  const [workspaceInitialTab, setWorkspaceInitialTab] = useState(getInitialWorkspaceTab)
  const [workspaceTeam, setWorkspaceTeam] = useState([])
  const [gmailConnections, setGmailConnections] = useState([])
  const [driveConnection, setDriveConnection] = useState(null)
  const [apiConnection, setApiConnection] = useState(null)
  const [activeConnector, setActiveConnector] = useState(null)
  const [oauthType, setOauthType] = useState('gmail')
  const [driveFolderOpen, setDriveFolderOpen] = useState(false)
  const [driveFolderId, setDriveFolderId] = useState(null)
  const [driveFolderLoading, setDriveFolderLoading] = useState(false)
  const [driveFolders, setDriveFolders] = useState([])
  const [driveFoldersLoading, setDriveFoldersLoading] = useState(false)
  const [driveConnecting, setDriveConnecting] = useState(false)
  const [apiConnectOpen, setApiConnectOpen] = useState(false)
  const [apiEndpoint, setApiEndpoint] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [apiConnectLoading, setApiConnectLoading] = useState(false)
  const [chatbotOpen, setChatbotOpen] = useState(false)
  const [todosPanelOpen, setTodosPanelOpen] = useState(false)
  const [dashboardTodos, setDashboardTodos] = useState(() => loadStoredDashboardTodos())
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('ez-theme')
      if (saved === 'dark') return 'dark'
      return 'light'
    } catch {
      return 'light'
    }
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try {
      localStorage.setItem('ez-theme', theme)
    } catch {
      /* ignore */
    }
  }, [theme])

  const beginGmailScan = () => {
    if (scanTimersRef.current) {
      scanTimersRef.current.timeouts.forEach(clearTimeout)
      clearInterval(scanTimersRef.current.cvInterval)
      scanTimersRef.current = null
    }
    setGmailScanning(true)
    setRevealedCandidateIds([])
    setScannedCvCount(0)
    setSelectedCandidate(null)
    setCurrentScreen('candidates')
  }

  useEffect(() => {
    if (currentScreen !== 'candidates' || !gmailScanning) return

    const qualified = [...candidates]
      .filter((c) => c.score >= 70)
      .sort((a, b) => b.score - a.score)

    const timeouts = []
    const cvInterval = setInterval(() => {
      setScannedCvCount((prev) => Math.min(31, prev + Math.floor(Math.random() * 3) + 2))
    }, 320)

    setScannedCvCount(3)

    qualified.forEach((c, index) => {
      const timeout = setTimeout(() => {
        setRevealedCandidateIds((prev) => [...prev, c.id])
        if (index === 0) {
          setSelectedCandidate(c.id)
        }
        if (index === qualified.length - 1) {
          clearInterval(cvInterval)
          setGmailScanning(false)
          setScannedCvCount(31)
          scanTimersRef.current = null
        }
      }, 1400 + index * 1100)
      timeouts.push(timeout)
    })

    scanTimersRef.current = { timeouts, cvInterval }

    return () => {
      timeouts.forEach(clearTimeout)
      clearInterval(cvInterval)
      scanTimersRef.current = null
    }
  }, [currentScreen, gmailScanning, candidates])

  const filteredCandidates = [...candidates]
    .sort((a, b) => b.score - a.score)

  const sidebarCandidates = candidatesLoading
    ? []
    : gmailScanning
      ? filteredCandidates.filter((c) => revealedCandidateIds.includes(c.id))
      : filteredCandidates

  const activeDashboardJob = dashboardJobs.find((job) => job.id === activeJobId) || null

  const showCandidateScanWaiting = !candidatesLoading
    && activeDashboardJob?.status === 'active'
    && sidebarCandidates.length === 0

  const activeJobRequirements = {
    title: activeDashboardJob?.title || extractedFields.title || EXTRACTED_JOB.title,
    experience: activeDashboardJob
      ? `${activeDashboardJob.exp_min}-${activeDashboardJob.exp_max} years`
      : extractedFields.expMin && extractedFields.expMax
        ? `${extractedFields.expMin}-${extractedFields.expMax} years`
        : EXTRACTED_JOB.expMin && EXTRACTED_JOB.expMax
          ? `${EXTRACTED_JOB.expMin}-${EXTRACTED_JOB.expMax} years`
          : '',
    education: activeDashboardJob?.education || extractedFields.education || EXTRACTED_JOB.education,
    primarySkills: activeDashboardJob?.required_skills?.length
      ? activeDashboardJob.required_skills
      : parseSkillsInput(extractedFields.primarySkillsText || formatSkillsInput([])).length > 0
        ? parseSkillsInput(extractedFields.primarySkillsText)
        : parseSkillsInput(EXTRACTED_JOB.primarySkillsText),
    secondarySkills: activeDashboardJob?.nice_skills?.length
      ? activeDashboardJob.nice_skills
      : parseSkillsInput(extractedFields.secondarySkillsText || '').length > 0
        ? parseSkillsInput(extractedFields.secondarySkillsText)
        : parseSkillsInput(EXTRACTED_JOB.secondarySkillsText),
  }

  const selected = candidates.find((c) => c.id === selectedCandidate)
  const emailRecipients = candidates.filter((c) => emailRecipientIds.includes(c.id))
  const allSidebarSelected = sidebarCandidates.length > 0
    && sidebarCandidates.every((c) => emailSelectedIds.includes(c.id))

  const toggleEmailSelection = (id, event) => {
    event?.stopPropagation()
    setEmailSelectedIds((prev) => (
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    ))
  }

  const toggleSelectAllSidebar = () => {
    const visibleIds = sidebarCandidates.map((c) => c.id)
    if (allSidebarSelected) {
      setEmailSelectedIds((prev) => prev.filter((id) => !visibleIds.includes(id)))
      return
    }
    setEmailSelectedIds((prev) => [...new Set([...prev, ...visibleIds])])
  }

  const openEmailModal = (ids) => {
    const uniqueIds = [...new Set(ids.filter(Boolean))]
    if (uniqueIds.length === 0) return
    setEmailRecipientIds(uniqueIds)
    setEmailModalOpen(true)
  }

  const handleEmailSent = (count) => {
    setEmailSentNotice({ count })
    setEmailRecipientIds([])
    setEmailSelectedIds([])
  }

  useEffect(() => {
    if (!emailSentNotice) return undefined
    const timer = setTimeout(() => setEmailSentNotice(null), 4200)
    return () => clearTimeout(timer)
  }, [emailSentNotice])

  useEffect(() => {
    if (!inboxToast) return undefined
    const timer = setTimeout(() => setInboxToast(null), 4200)
    return () => clearTimeout(timer)
  }, [inboxToast])

  useEffect(() => () => {
    gmailPollAbortRef.current?.abort()
    drivePollAbortRef.current?.abort()
    try {
      gmailOAuthPopupRef.current?.close()
      driveOAuthPopupRef.current?.close()
    } catch {
      /* ignore */
    }
  }, [])

  const closeGmailOAuthPopup = () => {
    try {
      gmailOAuthPopupRef.current?.close()
    } catch {
      /* ignore */
    }
    gmailOAuthPopupRef.current = null
  }

  const closeDriveOAuthPopup = () => {
    try {
      driveOAuthPopupRef.current?.close()
    } catch {
      /* ignore */
    }
    driveOAuthPopupRef.current = null
  }

  const finishConnectorSetup = (message, targetScreen = 'dashboard') => {
    setAssignInboxOpen(false)
    setAssignInboxLoading(false)
    setSelectedTeamMemberId(null)
    setTeamMembers([])
    setInboxToast({ message, variant: 'success' })
    setCurrentScreen(targetScreen)
  }

  const showErrorToast = (message, title = 'Error') => {
    setInboxToast({ message, title, variant: 'error' })
  }

  const showSuccessToast = (message, title) => {
    setInboxToast({ message, title, variant: 'success' })
  }

  const handleJobPermissionError = (err) => {
    if (err instanceof ApiError && err.status === 403) {
      showErrorToast('You can only manage jobs you created.')
      return true
    }
    return false
  }

  const loadBilling = useCallback(async () => {
    setBillingLoading(true)
    try {
      const [current, plans, jobsResponse] = await Promise.all([
        getBillingCurrent(),
        getBillingPlans(),
        fetchJobsList().catch(() => ({ jobs: [], jobs_used: 0, jobs_limit: 0 })),
      ])
      const purchasable = filterPurchasablePlans(plans)
      const { used: jobsUsed, max: jobsMax } = resolveJobUsage(current, jobsResponse)
      setBillingPlans(purchasable)
      const usage = billingCurrentToUsage(current, purchasable, jobsUsed)
      usage.jobsMax = jobsMax
      setWorkspaceUsage(usage)
      setDashboardJobs(jobsResponse.jobs || [])
      if (purchasable.length > 0) {
        setSelectedPlanId((prev) => (
          purchasable.some((plan) => plan.id === prev) ? prev : purchasable[0].id
        ))
      }
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Could not load billing')
    } finally {
      setBillingLoading(false)
    }
  }, [])

  const loadDashboardJobs = useCallback(async () => {
    try {
      const jobsResponse = await fetchJobsList()
      setDashboardJobs(jobsResponse.jobs || [])
      setWorkspaceUsage((prev) => ({
        ...prev,
        jobsUsed: jobsResponse.jobs_used ?? prev.jobsUsed,
      }))
    } catch {
      /* dashboard polling should fail quietly */
    }
  }, [])

  const loadAvailableSourcesForCreateJob = useCallback(async () => {
    const requestId = sourcesLoadRequestRef.current + 1
    sourcesLoadRequestRef.current = requestId
    setSourcesReady(false)

    try {
      const sources = await fetchAvailableSources()
      if (sourcesLoadRequestRef.current !== requestId) return
      setAvailableSources({
        gmail: sources.gmail || [],
        drive: sources.drive || null,
        api: sources.api || null,
      })
    } catch (err) {
      if (sourcesLoadRequestRef.current !== requestId) return
      showErrorToast(err instanceof Error ? err.message : 'Could not load sources')
    } finally {
      if (sourcesLoadRequestRef.current === requestId) {
        setSourcesReady(true)
      }
    }
  }, [])

  const loadWorkspaceConnectors = useCallback(async () => {
    try {
      const [connections, team, drive] = await Promise.all([
        fetchGmailConnectionsForUi(),
        fetchTeamMembersForUi(),
        fetchDriveConnection(),
      ])
      setGmailConnections(connections)
      const syncedTeam = syncTeamInboxAssignments(team, connections)
      setWorkspaceTeam(syncedTeam)
      const syncedRole = syncAuthRoleFromTeam(team)
      if (syncedRole) setAuthRoleState(syncedRole)
      setDriveConnection(drive)
      if (drive && driveHasFolder(drive)) {
        setActiveConnector((prev) => (prev === 'gmail' || prev === 'api' ? prev : 'drive'))
      } else if (connections.length > 0) {
        setActiveConnector((prev) => (prev === 'drive' || prev === 'api' ? prev : 'gmail'))
      }
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Could not load connections')
    }
  }, [])

  const openDriveFolderPicker = useCallback(async (preferredFolderId = null) => {
    setDriveFolderOpen(true)
    setDriveFolderId(preferredFolderId)
    setDriveFoldersLoading(true)
    try {
      const folders = await getDriveFolders()
      setDriveFolders(folders)
      setDriveFolderId((current) => {
        if (current && folders.some((folder) => folder.id === current)) return current
        return folders[0]?.id ?? null
      })
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Could not load Drive folders')
      setDriveFolderOpen(false)
    } finally {
      setDriveFoldersLoading(false)
    }
  }, [])

  const refreshDriveConnection = useCallback(async () => {
    const drive = await fetchDriveConnection()
    setDriveConnection(drive)
    if (drive && driveHasFolder(drive)) {
      setActiveConnector('drive')
    }
    return drive
  }, [])

  useEffect(() => {
    if (!getAuthToken()) return undefined

    const resolved = resolveAuthRole()
    if (resolved) setAuthRoleState(resolved)

    let cancelled = false
    fetchTeamMembersForUi()
      .then((team) => {
        if (cancelled) return
        const synced = syncAuthRoleFromTeam(team)
        if (synced) setAuthRoleState(synced)
      })
      .catch(() => {})

    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (currentScreen === 'workspace' || currentScreen === 'dashboard') {
      loadBilling()
    }
    if (currentScreen === 'workspace') {
      loadWorkspaceConnectors()
    }
  }, [currentScreen, loadBilling, loadWorkspaceConnectors])

  useEffect(() => {
    if (currentScreen !== 'create-job' || createJobView !== 'source') return undefined
    loadAvailableSourcesForCreateJob()
    return () => {
      sourcesLoadRequestRef.current += 1
    }
  }, [currentScreen, createJobView, loadAvailableSourcesForCreateJob])

  useEffect(() => {
    if (currentScreen !== 'dashboard') return undefined
    loadDashboardJobs()
    const interval = setInterval(loadDashboardJobs, 5000)
    return () => clearInterval(interval)
  }, [currentScreen, loadDashboardJobs])

  const startGmailConnectFlow = async ({ targetScreen = 'workspace', reconnectConnectionId = null } = {}) => {
    if (oauthConnecting || driveConnecting) return

    const usage = workspaceUsage
    const isReconnect = Boolean(reconnectConnectionId)

    if (!isReconnect && gmailConnections.length >= usage.gmailMax) {
      showErrorToast('Gmail connection limit reached on this plan.')
      return
    }

    if (!isReconnect && usage.singleConnector && activeConnector && activeConnector !== 'gmail' && gmailConnections.length === 0) {
      showErrorToast('Your plan allows Gmail or Drive, not both. Disconnect your current source first, or upgrade.')
      return
    }

    const knownIds = new Set(gmailConnections.map((item) => item.id))

    gmailPollAbortRef.current?.abort()
    gmailPollAbortRef.current = new AbortController()
    const { signal } = gmailPollAbortRef.current

    setOauthType('gmail')
    setOauthConnecting(true)
    setGmailConnectingConnectionId(reconnectConnectionId)

    const popup = openGmailConnectPopup()
    gmailOAuthPopupRef.current = popup

    if (!popup) {
      setOauthConnecting(false)
      setGmailConnectingConnectionId(null)
      showErrorToast('Could not open Google sign-in. Allow popups and try again.')
      return
    }

    try {
      const fresh = await pollForNewGmailConnection(knownIds, {
        signal,
        popup,
        reconnectConnectionId,
      })
      closeGmailOAuthPopup()

      const connections = await fetchGmailConnectionsForUi()
      setGmailConnections(connections)
      setActiveConnector('gmail')

      let members = workspaceTeam
      if (members.length === 0) {
        members = await fetchTeamMembersForUi()
      }
      setWorkspaceTeam(syncTeamInboxAssignments(members, connections))
      setOauthConnecting(false)
      setGmailConnectingConnectionId(null)

      const isNewConnection = !isReconnect && !knownIds.has(fresh.id)

      if (isNewConnection && isAdminRole(authRole) && members.length > 1) {
        setPendingAssignConnectionId(fresh.id)
        setAssignInboxEmail(fresh.gmail_email)
        setAssignInboxLoading(false)
        setAssignInboxOpen(true)
        setSelectedTeamMemberId(null)
        setTeamMembers(members)
        return
      }

      setInboxToast({
        message: isReconnect ? 'Gmail reconnected' : 'Gmail connected',
        variant: 'success',
      })
      if (pendingCreateJobFlow) {
        setCurrentScreen('create-job')
        setCreateJobView('source')
        setPendingCreateJobFlow(false)
        return
      }
      if (targetScreen !== 'workspace') setCurrentScreen(targetScreen)
    } catch (err) {
      closeGmailOAuthPopup()
      setOauthConnecting(false)
      setGmailConnectingConnectionId(null)

      if (err instanceof Error && err.message === 'Gmail connect cancelled') return

      const message = err instanceof Error && err.message.includes('timed out')
        ? "Couldn't connect Gmail. Refresh and try again."
        : err instanceof Error
          ? err.message
          : "Couldn't connect Gmail. Refresh and try again."
      showErrorToast(message)
    }
  }

  const handleReconnectGmail = (connectionId) => {
    startGmailConnectFlow({ targetScreen: 'workspace', reconnectConnectionId: connectionId })
  }

  const startDriveConnectFlow = async () => {
    if (oauthConnecting || driveConnecting) return

    const usage = workspaceUsage

    if (driveConnection) {
      showErrorToast('A Drive connection already exists for this workspace.')
      return
    }

    if (usage.singleConnector && activeConnector && activeConnector !== 'drive' && !driveConnection) {
      showErrorToast('Your plan allows Gmail or Drive, not both. Disconnect your current source first, or upgrade.')
      return
    }

    if (driveOAuthPopupRef.current && !driveOAuthPopupRef.current.closed) {
      driveOAuthPopupRef.current.focus()
      return
    }

    drivePollAbortRef.current?.abort()
    drivePollAbortRef.current = new AbortController()
    const { signal } = drivePollAbortRef.current

    setDriveConnecting(true)

    const popup = openDriveConnectPopup()
    driveOAuthPopupRef.current = popup

    if (!popup) {
      setDriveConnecting(false)
      showErrorToast('Could not open Google sign-in. Allow popups and try again.')
      return
    }

    try {
      const connection = await pollForDriveConnection({ signal, popup })
      closeDriveOAuthPopup()
      setDriveConnection(connection)
      setActiveConnector('drive')
      setDriveConnecting(false)

      if (!driveHasFolder(connection)) {
        await openDriveFolderPicker()
        return
      }

      setInboxToast({ message: 'Google Drive connected', variant: 'success' })
      if (pendingCreateJobFlow) {
        setCurrentScreen('create-job')
        setCreateJobView('source')
        setPendingCreateJobFlow(false)
      }
    } catch (err) {
      closeDriveOAuthPopup()
      setDriveConnecting(false)

      if (err instanceof Error && err.message === 'Drive connect cancelled') return

      const message = err instanceof Error && err.message.includes('timed out')
        ? "Couldn't connect Drive. Refresh and try again."
        : err instanceof Error
          ? err.message
          : "Couldn't connect Drive. Refresh and try again."
      showErrorToast(message)
    }
  }

  const handleChangeDriveFolder = () => {
    openDriveFolderPicker(driveConnection?.folder_id ?? null)
  }

  const handleDisconnectDrive = async () => {
    const confirmed = window.confirm(
      'Disconnect Google Drive? Scanning will stop immediately for this source.',
    )
    if (!confirmed) return

    try {
      await disconnectDriveConnection()
      setDriveConnection(null)
      if (activeConnector === 'drive') {
        setActiveConnector(null)
      }
      setDriveFolderOpen(false)
      setInboxToast({ message: 'Google Drive disconnected', variant: 'success' })
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Could not disconnect Drive')
    }
  }

  const handleWorkspaceConnect = async (option) => {
    const usage = workspaceUsage

    if (usage.singleConnector && activeConnector && activeConnector !== option.id) {
      if (option.id !== 'gmail' || gmailConnections.length === 0) {
        setInboxToast({ message: 'Demo plan includes one connector. Upgrade to add more.' })
        return
      }
    }

    if (option.id === 'gmail') {
      await startGmailConnectFlow({ targetScreen: 'workspace' })
      return
    }

    if (option.id === 'drive') {
      if (!usage.allowDrive && !usage.isDemo) {
        setInboxToast({ message: 'Upgrade your plan to connect Google Drive.' })
        return
      }

      await startDriveConnectFlow()
      return
    }

    if (option.id === 'api') {
      if (!usage.allowApi && !usage.isDemo) {
        setInboxToast({ message: 'Upgrade your plan to use API connect.' })
        return
      }

      setApiEndpoint('')
      setApiKey('')
      setApiConnectOpen(true)
    }
  }

  const handleDriveFolderConfirm = async () => {
    if (!driveFolderId) return

    setDriveFolderLoading(true)
    try {
      await setDriveFolder(driveFolderId)
      const drive = await refreshDriveConnection()
      setDriveFolderOpen(false)
      setInboxToast({
        message: drive?.folder_name
          ? `Drive folder "${drive.folder_name}" connected`
          : 'Drive folder connected',
        variant: 'success',
      })
      if (pendingCreateJobFlow) {
        setCurrentScreen('create-job')
        setCreateJobView('source')
        setPendingCreateJobFlow(false)
      }
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Could not connect folder')
    } finally {
      setDriveFolderLoading(false)
    }
  }

  const handleApiConnectSubmit = async () => {
    const endpoint = apiEndpoint.trim()
    const key = apiKey.trim()
    if (!endpoint || key.length < 8) return

    setApiConnectLoading(true)
    await new Promise((resolve) => setTimeout(resolve, 750))
    setApiConnection({
      endpoint,
      keyPreview: `••••${key.slice(-4)}`,
    })
    setActiveConnector('api')
    setApiConnectLoading(false)
    setApiConnectOpen(false)
    setApiEndpoint('')
    setApiKey('')
    setInboxToast({ message: 'API connected — CVs will sync automatically' })
  }

  const handleWorkspaceAssignInbox = async () => {
    const member = teamMembers.find((item) => item.id === selectedTeamMemberId)
    if (!member || !pendingAssignConnectionId) return

    setAssignInboxLoading(true)
    try {
      await assignGmailConnection(pendingAssignConnectionId, member.id)
      const connections = await fetchGmailConnectionsForUi()
      setGmailConnections(connections)
      setWorkspaceTeam((prev) => syncTeamInboxAssignments(prev, connections))
      setActiveConnector('gmail')
      setPendingAssignConnectionId(null)
      finishConnectorSetup(`Inbox assigned to ${member.name}`, 'workspace')
    } catch (err) {
      setAssignInboxLoading(false)
      showErrorToast(err instanceof Error ? err.message : 'Could not assign inbox')
    }
  }

  const handleWorkspaceSkipAssignInbox = () => {
    setAssignInboxOpen(false)
    setAssignInboxLoading(false)
    setSelectedTeamMemberId(null)
    setPendingAssignConnectionId(null)
    setTeamMembers([])
    setInboxToast({ message: 'Gmail connected', variant: 'success' })
  }

  const handleInviteEmployee = async ({ name, email }) => {
    const memberId = Date.now()
    setWorkspaceTeam((prev) => [
      ...prev,
      {
        id: memberId,
        name,
        email,
        role: 'Employee',
        inviteStatus: 'pending',
        assignedInboxId: null,
      },
    ])
    setInboxToast({ message: `Invitation sent to ${email}` })

    await new Promise((resolve) => setTimeout(resolve, 2200))
    setWorkspaceTeam((prev) => prev.map((member) => (
      member.id === memberId && member.inviteStatus === 'pending'
        ? { ...member, inviteStatus: 'accepted' }
        : member
    )))
    setInboxToast({ message: `${name} accepted the invitation` })
  }

  const handleAssignTeamInbox = async (memberId, inboxId) => {
    if (inboxId) {
      try {
        await assignGmailConnection(String(inboxId), String(memberId))
      } catch (err) {
        showErrorToast(err instanceof Error ? err.message : 'Could not assign inbox')
        return
      }
    }

    setWorkspaceTeam((prev) => prev.map((member) => {
      if (member.id === memberId) {
        return { ...member, assignedInboxId: inboxId }
      }
      if (inboxId && member.assignedInboxId === inboxId && member.id !== memberId) {
        return { ...member, assignedInboxId: null }
      }
      return member
    }))

    setGmailConnections((prev) => prev.map((conn) => {
      if (inboxId && conn.id === inboxId) {
        return { ...conn, assignedMemberId: memberId }
      }
      if (conn.assignedMemberId === memberId && conn.id !== inboxId) {
        return { ...conn, assignedMemberId: null }
      }
      return conn
    }))
  }

  const handleSuspendTeamMember = (memberId) => {
    setWorkspaceTeam((prev) => prev.map((member) => {
      if (member.id !== memberId || member.role === 'Admin') return member
      if (member.inviteStatus === 'suspended') {
        return { ...member, inviteStatus: 'accepted' }
      }
      if (member.inviteStatus === 'accepted') {
        return { ...member, inviteStatus: 'suspended' }
      }
      return member
    }))
  }

  const handleDeleteTeamMember = (memberId) => {
    setWorkspaceTeam((prev) => prev.filter((member) => member.id !== memberId))
    setGmailConnections((prev) => prev.map((conn) => (
      conn.assignedMemberId === memberId ? { ...conn, assignedMemberId: null } : conn
    )))
    setInboxToast({ message: 'Team member removed' })
  }

  const handleDisconnectGmail = async (connectionId) => {
    try {
      await disconnectGmailConnection(String(connectionId))
      const connections = await fetchGmailConnectionsForUi()
      setGmailConnections(connections)
      setWorkspaceTeam((prev) => syncTeamInboxAssignments(prev, connections))
      if (connections.length === 0 && activeConnector === 'gmail') {
        setActiveConnector(null)
      }
      setInboxToast({ message: 'Gmail disconnected', variant: 'success' })
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Could not disconnect Gmail')
    }
  }

  const handlePlanPaymentVerified = async ({ planName } = {}) => {
    setUpgradePlanOpen(false)
    setSelectedPlanId(billingPlans[0]?.id ?? 'starter')
    await loadBilling()
    if (currentScreen === 'workspace') {
      goToBillingPath()
      setWorkspaceInitialTab('billing')
    }
    setPaymentCelebration({
      planName: planName || workspaceUsage.planName,
      key: Date.now(),
    })
  }

  const openUpgradePlan = async () => {
    if (billingPlans.length === 0) {
      await loadBilling()
    }
    setUpgradePlanOpen(true)
  }

  const handleAssignInbox = async () => {
    if (currentScreen === 'workspace') {
      await handleWorkspaceAssignInbox()
      return
    }

    const member = teamMembers.find((item) => item.id === selectedTeamMemberId)
    if (!member || !pendingAssignConnectionId) return

    setAssignInboxLoading(true)
    try {
      await assignGmailConnection(pendingAssignConnectionId, member.id)
      setPendingAssignConnectionId(null)
      finishConnectorSetup(`Inbox assigned to ${member.name}`)
    } catch (err) {
      setAssignInboxLoading(false)
      showErrorToast(err instanceof Error ? err.message : 'Could not assign inbox')
    }
  }

  const handleSkipAssignInbox = async () => {
    if (currentScreen === 'workspace') {
      handleWorkspaceSkipAssignInbox()
      return
    }
    setAssignInboxOpen(false)
    setAssignInboxLoading(false)
    setSelectedTeamMemberId(null)
    setPendingAssignConnectionId(null)
    setTeamMembers([])
    if (pendingCreateJobFlow) {
      setCurrentScreen('create-job')
      setCreateJobView('source')
      setPendingCreateJobFlow(false)
      setInboxToast({ message: 'Gmail connected', variant: 'success' })
      return
    }
    setInboxToast({ message: 'Gmail connected', variant: 'success' })
    setCurrentScreen('dashboard')
  }

  const proceedToJobDetailsForm = (sourceType, connectionId = null) => {
    setChosenSourceType(sourceType)
    setChosenGmailConnectionId(connectionId)
    setGmailSourcePickerOpen(false)
    setCreateJobView('options')
  }

  const handleCreateJobSourceChosen = async (sourceType, connectionId = null) => {
    const sources = availableSources

    if (sourceType === 'gmail') {
      if (!sources.gmail?.length) {
        setInboxToast({ message: 'Connect a Gmail inbox first to scan from it.', variant: 'error' })
        setPendingCreateJobFlow(true)
        await startGmailConnectFlow({ targetScreen: 'create-job' })
        return
      }
      if (sources.gmail.length === 1) {
        proceedToJobDetailsForm('gmail', sources.gmail[0].id)
        return
      }
      setGmailSourcePickerOpen(true)
      return
    }

    if (sourceType === 'drive') {
      if (!sources.drive) {
        setInboxToast({ message: 'Connect Google Drive first to scan from it.', variant: 'error' })
        setPendingCreateJobFlow(true)
        await startDriveConnectFlow()
        return
      }
      if (!sources.drive.folder_name && !sources.drive.folder_id) {
        setPendingCreateJobFlow(true)
        await openDriveFolderPicker()
        return
      }
      proceedToJobDetailsForm('drive', null)
    }
  }

  const submitJob = async () => {
    const validationErrors = validateJobFormFields({
      expMin: extractedFields.expMin,
      expMax: extractedFields.expMax,
      scanFromDate,
      scanToDate,
    })
    setJobFormErrors(validationErrors)
    if (Object.keys(validationErrors).length > 0) return
    if (!extractedFields.title.trim() || !chosenSourceType) return

    const expMin = parseOptionalInt(extractedFields.expMin) ?? 0
    const expMax = parseOptionalInt(extractedFields.expMax) ?? 99

    const payload = {
      title: extractedFields.title.trim(),
      exp_min: expMin,
      exp_max: expMax,
      ...(extractedFields.education.trim() ? { education: extractedFields.education.trim() } : {}),
      ...(extractedFields.location.trim() ? { location: extractedFields.location.trim() } : {}),
      required_skills: parseSkillsInput(extractedFields.primarySkillsText),
      nice_skills: parseSkillsInput(extractedFields.secondarySkillsText),
      source_type: chosenSourceType,
      source_connection_id: chosenSourceType === 'gmail' ? chosenGmailConnectionId : null,
      ...(scanFromDate ? { scan_from_date: scanFromDate } : {}),
      ...(scanToDate ? { scan_to_date: scanToDate } : {}),
    }

    setJobSubmitting(true)
    try {
      const job = await createJob(payload)
      await scanJob(job.id)
      setInboxToast({ message: `Job "${payload.title}" created — scan complete`, variant: 'success' })
      setCreateJobView('source')
      setChosenSourceType(null)
      setChosenGmailConnectionId(null)
      setScanFromDate('')
      setScanToDate('')
      setExtractedFields({ ...EMPTY_JOB_FORM })
      setExtracted(false)
      setCurrentScreen('dashboard')
      await loadDashboardJobs()
      await loadBilling()
    } catch (err) {
      if (handleJobPermissionError(err)) return
      if (err instanceof ApiError) {
        if (err.status === 400 && err.message.toLowerCase().includes('job limit')) {
          showErrorToast(err.message, 'Job limit reached')
          openUpgradePlan()
          return
        }
        if (err.status === 404) {
          showErrorToast('Selected source is no longer connected. Refresh and pick a source again.')
          return
        }
      }
      showErrorToast(err instanceof Error ? err.message : 'Could not create job')
    } finally {
      setJobSubmitting(false)
    }
  }

  const handleScanNow = async (jobId) => {
    setScanningJobId(jobId)
    try {
      await scanJob(jobId)
      setInboxToast({ message: 'Scan complete — refreshing results', variant: 'success' })
      await loadDashboardJobs()
    } catch (err) {
      if (handleJobPermissionError(err)) return
      if (err instanceof ApiError && err.status === 429) {
        setInboxToast({ message: 'Just scanned — wait a moment and try again.', variant: 'error' })
        return
      }
      if (err instanceof ApiError && err.status === 400) {
        showErrorToast(err.message)
        return
      }
      showErrorToast(err instanceof Error ? err.message : 'Scan failed')
    } finally {
      setScanningJobId(null)
    }
  }

  const handlePauseJob = async (jobId) => {
    try {
      await pauseJob(jobId)
      await loadDashboardJobs()
    } catch (err) {
      if (!handleJobPermissionError(err)) {
        showErrorToast(err instanceof Error ? err.message : 'Could not pause job')
      }
    }
  }

  const handleResumeJob = async (jobId) => {
    try {
      await resumeJob(jobId)
      await loadDashboardJobs()
    } catch (err) {
      if (!handleJobPermissionError(err)) {
        showErrorToast(err instanceof Error ? err.message : 'Could not resume job')
      }
    }
  }

  const handleCloseJob = async (jobId) => {
    try {
      await closeJob(jobId)
      await loadDashboardJobs()
    } catch (err) {
      if (!handleJobPermissionError(err)) {
        showErrorToast(err instanceof Error ? err.message : 'Could not close job')
      }
    }
  }

  const handleReopenJob = async (jobId) => {
    try {
      await reopenJob(jobId)
      await loadDashboardJobs()
    } catch (err) {
      if (!handleJobPermissionError(err)) {
        showErrorToast(err instanceof Error ? err.message : 'Could not reopen job')
      }
    }
  }

  const handleDeleteJob = async (jobId) => {
    if (!window.confirm('Delete this job? All candidate scores and history for it will be permanently lost. This cannot be undone.')) {
      return
    }
    try {
      await deleteJob(jobId)
      if (activeJobId === jobId) {
        setActiveJobId(null)
        setCandidates([])
        if (currentScreen === 'candidates') setCurrentScreen('dashboard')
      }
      await loadDashboardJobs()
      setInboxToast({ message: 'Job deleted', variant: 'success' })
    } catch (err) {
      if (!handleJobPermissionError(err)) {
        showErrorToast(err instanceof Error ? err.message : 'Could not delete job')
      }
    }
  }

  const openEditJobModal = (job) => {
    const fields = {
      title: job.title || '',
      expMin: job.exp_min != null ? String(job.exp_min) : '',
      expMax: job.exp_max != null ? String(job.exp_max) : '',
      education: job.education || '',
      location: job.location || '',
      primarySkillsText: formatSkillsInput(job.required_skills || []),
      secondarySkillsText: formatSkillsInput(job.nice_skills || []),
    }
    setEditJobId(job.id)
    setEditJobFields(fields)
    setEditScanFromDate(job.scan_from_date || '')
    setEditScanToDate(job.scan_to_date || '')
    setEditJobErrors({})
    setEditJobSnapshot({
      fields,
      scanFromDate: job.scan_from_date || '',
      scanToDate: job.scan_to_date || '',
    })
    setEditJobOpen(true)
  }

  const saveJobEdit = async () => {
    const validationErrors = validateJobFormFields({
      expMin: editJobFields.expMin,
      expMax: editJobFields.expMax,
      scanFromDate: editScanFromDate,
      scanToDate: editScanToDate,
    })
    setEditJobErrors(validationErrors)
    if (Object.keys(validationErrors).length > 0 || !editJobId || !editJobSnapshot) return
    if (!editJobFields.title.trim()) return

    const expMin = parseOptionalInt(editJobFields.expMin) ?? 0
    const expMax = parseOptionalInt(editJobFields.expMax) ?? 99
    const nextPayload = {
      title: editJobFields.title.trim(),
      exp_min: expMin,
      exp_max: expMax,
      education: editJobFields.education.trim(),
      location: editJobFields.location.trim(),
      required_skills: parseSkillsInput(editJobFields.primarySkillsText),
      nice_skills: parseSkillsInput(editJobFields.secondarySkillsText),
      scan_from_date: editScanFromDate,
      scan_to_date: editScanToDate,
    }
    const prevPayload = {
      title: editJobSnapshot.fields.title.trim(),
      exp_min: parseOptionalInt(editJobSnapshot.fields.expMin) ?? 0,
      exp_max: parseOptionalInt(editJobSnapshot.fields.expMax) ?? 99,
      education: editJobSnapshot.fields.education.trim(),
      location: editJobSnapshot.fields.location.trim(),
      required_skills: parseSkillsInput(editJobSnapshot.fields.primarySkillsText),
      nice_skills: parseSkillsInput(editJobSnapshot.fields.secondarySkillsText),
      scan_from_date: editJobSnapshot.scanFromDate,
      scan_to_date: editJobSnapshot.scanToDate,
    }

    const changes = {}
    if (nextPayload.title !== prevPayload.title) changes.title = nextPayload.title
    if (nextPayload.exp_min !== prevPayload.exp_min) changes.exp_min = nextPayload.exp_min
    if (nextPayload.exp_max !== prevPayload.exp_max) changes.exp_max = nextPayload.exp_max
    if (nextPayload.education !== prevPayload.education) changes.education = nextPayload.education
    if (nextPayload.location !== prevPayload.location) changes.location = nextPayload.location
    if (nextPayload.scan_from_date !== prevPayload.scan_from_date) changes.scan_from_date = nextPayload.scan_from_date
    if (nextPayload.scan_to_date !== prevPayload.scan_to_date) changes.scan_to_date = nextPayload.scan_to_date
    if (JSON.stringify(nextPayload.required_skills) !== JSON.stringify(prevPayload.required_skills)) {
      changes.required_skills = nextPayload.required_skills
    }
    if (JSON.stringify(nextPayload.nice_skills) !== JSON.stringify(prevPayload.nice_skills)) {
      changes.nice_skills = nextPayload.nice_skills
    }

    if (Object.keys(changes).length === 0) {
      setEditJobOpen(false)
      return
    }

    setEditJobSaving(true)
    try {
      await updateJob(editJobId, changes)
      setEditJobOpen(false)
      setInboxToast({ message: 'Job updated', variant: 'success' })
      await loadDashboardJobs()
      if (activeJobId === editJobId) {
        await reloadActiveJobCandidates()
      }
    } catch (err) {
      if (!handleJobPermissionError(err)) {
        showErrorToast(err instanceof Error ? err.message : 'Could not update job')
      }
    } finally {
      setEditJobSaving(false)
    }
  }

  const openCandidatesForJob = async (jobId) => {
    setActiveJobId(jobId)
    setSelectedCandidate(null)
    setEmailSelectedIds([])
    setCandidatesLoading(true)
    setGmailScanning(false)
    setCurrentScreen('candidates')
    try {
      const mapped = await fetchJobCandidates(jobId)
      setCandidates(mapped)
      if (mapped.length > 0) setSelectedCandidate(mapped[0].id)
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Could not load candidates')
      setCandidates([])
    } finally {
      setCandidatesLoading(false)
    }
  }

  const reloadActiveJobCandidates = useCallback(async () => {
    if (!activeJobId) return
    try {
      const mapped = await fetchJobCandidates(activeJobId)
      setCandidates(mapped)
    } catch {
      /* ignore refresh errors */
    }
  }, [activeJobId])

  useEffect(() => {
    if (currentScreen !== 'candidates' || !activeJobId) return undefined
    const interval = setInterval(() => {
      reloadActiveJobCandidates()
    }, 5000)
    return () => clearInterval(interval)
  }, [currentScreen, activeJobId, reloadActiveJobCandidates])

  const openCreateJob = async () => {
    setCreateJobView('source')
    setChosenSourceType(null)
    setChosenGmailConnectionId(null)
    setScanFromDate('')
    setScanToDate('')
    setJobFormErrors({})
    setShowScanModal(false)
    setScanOption(30)
    setExtracted(false)
    setExtractedFields({ ...EMPTY_JOB_FORM })
    setExtracting(false)
    setCurrentScreen('create-job')
  }

  const runJobParsing = () => {
    setCreateJobView('parsing')
    setExtracting(true)
    setExtracted(false)
    setTimeout(() => {
      setExtractedFields(EXTRACTED_JOB)
      setExtracting(false)
      setExtracted(true)
      setCreateJobView('form')
    }, 1800)
  }

  const startCreateManual = () => {
    setExtractedFields({ ...EMPTY_JOB_FORM })
    setExtracted(true)
    setExtracting(false)
    setCreateJobView('form')
  }

  const handleJdFileUpload = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    runJobParsing()
    e.target.value = ''
  }

  const handleSaveCandidateNote = async (applicationId, noteText) => {
    try {
      await saveApplicationNote(applicationId, noteText)
      setCandidates((prev) => prev.map((c) => (
        c.id === applicationId || c.applicationId === applicationId
          ? { ...c, recruiterNote: noteText }
          : c
      )))
      setInboxToast({ message: 'Note saved', variant: 'success' })
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        showErrorToast('Candidate not found, please refresh.')
        return
      }
      showErrorToast(err instanceof Error ? err.message : 'Could not save note')
    }
  }

  const updateStage = async (id, stage) => {
    const apiStage = uiStageToApi(stage)
    setCandidates((prev) => prev.map((c) => (c.id === id ? { ...c, stage } : c)))
    try {
      await updateApplicationStage(id, apiStage)
      await reloadActiveJobCandidates()
      loadDashboardJobs()
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Could not update stage')
      await reloadActiveJobCandidates()
    }
  }

  const handleSendCandidateEmail = async ({ subject, bodyHtml, applicationIds }) => {
    await sendApplicationEmail({
      application_ids: applicationIds,
      subject,
      body_html: bodyHtml.replace(/\n/g, '<br />'),
    })
    await reloadActiveJobCandidates()
    loadDashboardJobs()
  }

  const DashboardNavbar = () => (
    <nav className="theme-nav border-b px-8 py-4 flex items-center justify-between sticky top-0 z-10">
      <div className="flex items-center">
        <Logo className="text-lg mr-10" />
        <button type="button" className="type-nav font-semibold theme-heading border-b-2 border-[#2d6a84] pb-1">
          Dashboard
        </button>
      </div>
      <div className="flex items-center gap-4">
        <ThemeSwitcher theme={theme} onChange={setTheme} />
        <div className="border-l pl-4 profile-menu-wrap" style={{ borderColor: 'var(--ez-border-light)' }}>
          <ProfileMenu userName={authUserName} onLogout={handleLogout} />
        </div>
      </div>
    </nav>
  )

  const DashboardFooter = () => (
    <footer className="dashboard-footer">
      <div className="dashboard-footer-inner">
        <span className="dashboard-footer-copy type-body theme-footer">InboxHire © 2026</span>
        <nav className="dashboard-footer-links type-label theme-footer" aria-label="Footer">
          <button type="button" className="dashboard-footer-link">Terms of Service</button>
          <span className="dashboard-footer-sep" aria-hidden="true">·</span>
          <button type="button" className="dashboard-footer-link">Privacy Policy</button>
        </nav>
        <div className="dashboard-footer-end">
          <button type="button" className="dashboard-footer-icon-btn" aria-label="Organization">
            <FaIcon icon="building" size={14} />
          </button>
        </div>
      </div>
    </footer>
  )

  const goToSignIn = () => {
    goToAppRoot()
    setCurrentScreen('signin')
    setSignInMode('login')
    setSignInLoading(false)
    setNewPassword('')
    setConfirmNewPassword('')
  }

  const handleLogout = () => {
    logout()
    setAuthUserName('')
    setAuthRoleState('')
    setSignInEmail('')
    setSignInPassword('')
    goToSignIn()
  }

  const dashboardFirstName = authUserName.trim().split(/\s+/)[0] || 'there'

  const handleSignIn = async () => {
    const email = signInEmail.trim()
    const password = signInPassword
    if (!email || !password) {
      showErrorToast('Enter your email and password')
      return
    }

    setSignInLoading(true)
    try {
      const result = await login({ email, password })
      setAuthToken(result.token)
      const name = result.name || ''
      persistAuthUserName(name)
      setAuthUserName(name)
      persistAuthEmail(email)
      const role = normalizeAuthRole(result.role || resolveAuthRole())
      persistAuthRole(role)
      setAuthRoleState(role)
      if (result.must_change_password) {
        setMustChangePassword(true)
        setSignInMode('reset-password')
      } else {
        setMustChangePassword(false)
        goToAppRoot()
        setCurrentScreen('dashboard')
      }
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Invalid email or password')
    } finally {
      setSignInLoading(false)
    }
  }

  const handleFirstLoginPassword = async () => {
    if (newPassword.length < 8) {
      showErrorToast('Password must be at least 8 characters')
      return
    }
    if (newPassword !== confirmNewPassword) {
      showErrorToast('Passwords do not match')
      return
    }

    setChangePasswordLoading(true)
    try {
      await changePassword({ new_password: newPassword })
      setMustChangePassword(false)
      setNewPassword('')
      setConfirmNewPassword('')
      setSignInMode('login')
      const role = normalizeAuthRole(getAuthRole() || resolveAuthRole())
      setAuthRoleState(role)
      if (isAdminRole(role)) {
        goToBillingPath()
        setWorkspaceInitialTab('billing')
        setCurrentScreen('workspace')
      } else {
        goToAppRoot()
        setCurrentScreen('dashboard')
      }
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setChangePasswordLoading(false)
    }
  }

  if (currentScreen === 'reset-password') {
    return (
      <>
        <ResetPasswordScreen
          theme={theme}
          onThemeChange={setTheme}
          resetToken={resetToken}
          onSignIn={goToSignIn}
          onError={showErrorToast}
          onForgotPassword={() => {
            goToAppRoot()
            setCurrentScreen('forgot-password')
          }}
        />
        <AppToast toast={inboxToast} onClose={() => setInboxToast(null)} />
      </>
    )
  }

  /* ─── SCREEN 1: SIGN IN ─── */
  if (currentScreen === 'signin') {
    return (
      <div className="min-h-screen relative signin-bg overflow-hidden">
        <div className="signin-mesh" aria-hidden="true">
          <div className="signin-blob signin-blob-1" />
          <div className="signin-blob signin-blob-2" />
          <div className="signin-blob signin-blob-3" />
          <div className="signin-blob signin-blob-4" />
          <div className="signin-blob signin-blob-5" />
        </div>

        <nav className="relative z-10 px-10 py-6 flex items-center justify-between animate-signin-nav">
          <Logo className="text-xl" />
          <div className="flex items-center gap-4">
            <button type="button" className="type-nav theme-nav-link">Documentation</button>
            <ThemeSwitcher theme={theme} onChange={setTheme} />
          </div>
        </nav>

        <div className="relative z-10 flex min-h-[calc(100vh-140px)]">
          <div className="flex-1 flex items-center pl-24 pr-4">
            <div className="w-full max-w-2xl">
              <h1 className="type-hero signin-title animate-signin-heading w-fit leading-[1.15]">
                Hire Faster.<br />Screen Smarter.
              </h1>
              <p className="type-subheading signin-para mt-4 animate-signin-subtext">
                Connect Gmail. Get ranked, scored candidates automatically.<br />
                No manual CV reading. No missed talent.
              </p>

              <SignInProductDemo />
            </div>
          </div>

          <div className="flex-1 flex items-center justify-center pl-35 pr-8">
            <div className="signin-card w-[420px] rounded-3xl p-10 ml-10 animate-signin-form">
              {signInMode === 'reset-password' ? (
                <>
                  <h2 className="type-section signin-title w-fit">Reset password</h2>
                  <p className="type-subheading signin-para mt-1 mb-8">
                    Set a new password to continue.
                  </p>

                  <label htmlFor="first-login-password" className="type-label theme-muted mb-1.5 block">
                    New password
                  </label>
                  <div className="relative mb-4">
                    <input
                      id="first-login-password"
                      type={showPassword ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Minimum 8 characters"
                      autoComplete="new-password"
                      className="signin-input theme-input type-input rounded-xl px-4 py-3 w-full focus:outline-none pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((visible) => !visible)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-pressed={showPassword}
                      className="absolute right-3 top-1/2 z-10 -translate-y-1/2 theme-muted cursor-pointer transition-transform duration-200 hover:scale-110"
                    >
                      {showPassword ? <FaIcon icon="eye" size={18} /> : <FaIcon icon="eye-slash" size={18} />}
                    </button>
                  </div>

                  <label htmlFor="first-login-password-confirm" className="type-label theme-muted mb-1.5 block">
                    Confirm password
                  </label>
                  <input
                    id="first-login-password-confirm"
                    type={showPassword ? 'text' : 'password'}
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    placeholder="Re-enter your password"
                    autoComplete="new-password"
                    className="signin-input theme-input type-input rounded-xl px-4 py-3 w-full focus:outline-none mb-4"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleFirstLoginPassword()
                    }}
                  />

                  <button
                    type="button"
                    onClick={handleFirstLoginPassword}
                    disabled={changePasswordLoading || newPassword.length < 8 || confirmNewPassword.length < 8}
                    className="signin-btn-primary type-button mt-2 text-white rounded-xl py-3 px-6 w-full disabled:opacity-45"
                  >
                    {changePasswordLoading ? 'Saving…' : 'Continue to dashboard'}
                  </button>
                </>
              ) : (
                <>
              <h2 className="type-section signin-title w-fit max-w-[10.5rem]">Get Started Now</h2>
              <p className="type-subheading signin-para mt-1 mb-8">Please sign in to continue</p>

              <label htmlFor="signin-email" className="type-label theme-muted mb-1.5 block">
                Email
              </label>
              <input
                id="signin-email"
                type="email"
                value={signInEmail}
                onChange={(e) => setSignInEmail(e.target.value)}
                placeholder="you@company.com"
                autoComplete="email"
                className="signin-input theme-input type-input rounded-xl px-4 py-3 w-full focus:outline-none mb-4"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSignIn()
                }}
              />

              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="signin-password" className="type-label theme-muted">Password</label>
                <button type="button" onClick={() => setCurrentScreen('forgot-password')} className="type-caption text-ez-accent font-medium hover:underline transition-all duration-200">Forgot password?</button>
              </div>
              <div className="relative mb-2">
                <input
                  id="signin-password"
                  type={showPassword ? 'text' : 'password'}
                  value={signInPassword}
                  onChange={(e) => setSignInPassword(e.target.value)}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  className="signin-input theme-input type-input rounded-xl px-4 py-3 w-full focus:outline-none pr-10"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSignIn()
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  className="absolute right-3 top-1/2 z-10 -translate-y-1/2 theme-muted cursor-pointer transition-transform duration-200 hover:scale-110"
                >
                  {showPassword ? <FaIcon icon="eye" size={18} /> : <FaIcon icon="eye-slash" size={18} />}
                </button>
              </div>

              <button
                type="button"
                onClick={handleSignIn}
                disabled={signInLoading || !signInEmail.trim() || !signInPassword}
                className="signin-btn-primary type-button mt-6 text-white rounded-xl py-3 px-6 w-full disabled:opacity-45"
              >
                {signInLoading ? 'Signing in…' : 'Sign In'}
              </button>

              <div className="relative my-6">
                <hr className="signin-divider" />
                <span className="signin-divider-label absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 px-3 type-label theme-footer">
                  OR
                </span>
              </div>

              <button
                type="button"
                onClick={() => setCurrentScreen('signup')}
                className="signin-btn-outline type-button rounded-xl py-2.5 px-5 w-full theme-heading"
              >
                Sign Up
              </button>
                </>
              )}
            </div>
          </div>
        </div>

        <footer className="absolute bottom-0 z-10 w-full text-center pb-4 animate-signin-footer">
          <p className="type-label theme-footer">
            POWERED BY DEEPTALENT TECHNOLOGIES. ALL RIGHTS RESERVED 2026 | TERMS | PRIVACY POLICY
          </p>
        </footer>
        <AppToast toast={inboxToast} onClose={() => setInboxToast(null)} />
      </div>
    )
  }

  if (currentScreen === 'forgot-password') {
    return (
      <>
        <ForgotPasswordScreen
          theme={theme}
          onThemeChange={setTheme}
          onBack={() => setCurrentScreen('signin')}
          onError={showErrorToast}
        />
        <AppToast toast={inboxToast} onClose={() => setInboxToast(null)} />
      </>
    )
  }

  if (currentScreen === 'signup') {
    return (
      <>
        <SignUpWizard
          theme={theme}
          onThemeChange={setTheme}
          onBack={() => setCurrentScreen('signin')}
          onError={showErrorToast}
        />
        <AppToast toast={inboxToast} onClose={() => setInboxToast(null)} />
      </>
    )
  }

  if (currentScreen === 'workspace') {
    return (
      <>
        <WorkspaceScreen
          theme={theme}
          onThemeChange={setTheme}
          usage={workspaceUsage}
          billingLoading={billingLoading}
          initialTab={workspaceInitialTab}
          isAdmin={isAdminRole(authRole)}
          teamMembers={workspaceTeam}
          gmailConnections={gmailConnections}
          driveConnection={driveConnection}
          driveConnecting={driveConnecting}
          apiConnection={apiConnection}
          activeConnector={activeConnector}
          onConnectSource={handleWorkspaceConnect}
          onDisconnectDrive={handleDisconnectDrive}
          onChangeDriveFolder={handleChangeDriveFolder}
          onUpgrade={openUpgradePlan}
          onInviteEmployee={handleInviteEmployee}
          onDisconnectGmail={handleDisconnectGmail}
          onReconnectGmail={handleReconnectGmail}
          onAssignTeamInbox={handleAssignTeamInbox}
          onSuspendTeamMember={handleSuspendTeamMember}
          onDeleteTeamMember={handleDeleteTeamMember}
          onGoToDashboard={() => setCurrentScreen('dashboard')}
          onShowSuccess={showSuccessToast}
          onShowError={showErrorToast}
          gmailConnecting={oauthConnecting && oauthType === 'gmail'}
          gmailConnectingConnectionId={gmailConnectingConnectionId}
        />

        <DriveFolderModal
          open={driveFolderOpen}
          loading={driveFolderLoading}
          foldersLoading={driveFoldersLoading}
          folders={driveFolders}
          selectedId={driveFolderId}
          onSelect={setDriveFolderId}
          onConfirm={handleDriveFolderConfirm}
          onClose={() => !driveFolderLoading && setDriveFolderOpen(false)}
        />

        <ApiConnectModal
          open={apiConnectOpen}
          loading={apiConnectLoading}
          endpoint={apiEndpoint}
          apiKey={apiKey}
          onEndpointChange={setApiEndpoint}
          onApiKeyChange={setApiKey}
          onConnect={handleApiConnectSubmit}
          onClose={() => !apiConnectLoading && setApiConnectOpen(false)}
        />

        <AssignInboxModal
          open={assignInboxOpen}
          email={assignInboxEmail}
          loading={assignInboxLoading}
          members={teamMembers}
          selectedId={selectedTeamMemberId}
          onSelect={setSelectedTeamMemberId}
          onSkip={handleSkipAssignInbox}
          onAssign={handleAssignInbox}
        />

        <UpgradePlanModal
          open={upgradePlanOpen}
          selectedPlanId={selectedPlanId}
          upgradePlans={billingPlans}
          currentPlanId={workspaceUsage.planId}
          isOnDemoPlan={workspaceUsage.isDemo}
          onSelectPlan={setSelectedPlanId}
          onPaymentVerified={handlePlanPaymentVerified}
          onError={showErrorToast}
          onClose={() => {
            setUpgradePlanOpen(false)
            setSelectedPlanId(billingPlans[0]?.id ?? 'starter')
          }}
        />

        <PaymentSuccessCelebration
          celebration={paymentCelebration}
          onClose={() => setPaymentCelebration(null)}
        />

        <AppToast toast={inboxToast} onClose={() => setInboxToast(null)} />
      </>
    )
  }

  /* ─── SCREEN: CREATE JOB ─── */
  if (currentScreen === 'create-job') {
    const jobFormReady = extractedFields.title.trim().length > 0

    return (
      <div className="page-bg min-h-screen">
        <nav className="theme-nav border-b px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setCurrentScreen('dashboard')}
              className="theme-toggle w-8 h-8 rounded-lg flex items-center justify-center"
            >
              <FaIcon icon="arrow-left" size={16} />
            </button>
            <Logo className="text-lg" />
          </div>
          <div className="flex items-center gap-4">
            <ThemeSwitcher theme={theme} onChange={setTheme} />
          </div>
        </nav>

        <main className={`create-job-main mx-auto px-6 ${createJobView === 'form' ? 'create-job-main--form' : createJobView === 'options' ? 'create-job-main--options' : 'max-w-3xl py-10'}`}>
          {createJobView === 'source' && (
            <SourcePicker
              ready={sourcesReady}
              gmailOptions={availableSources.gmail}
              driveSource={availableSources.drive}
              onSelectGmail={() => handleCreateJobSourceChosen('gmail')}
              onSelectDrive={() => handleCreateJobSourceChosen('drive')}
            />
          )}

          {createJobView === 'options' && (
            <JobSetupOptions
              onSelectPaste={() => setCreateJobView('paste')}
              onSelectUpload={() => setCreateJobView('upload')}
              onSelectManual={startCreateManual}
              onChangeSource={() => setCreateJobView('source')}
            />
          )}

          {createJobView === 'paste' && (
            <div className="dashboard-card rounded-3xl p-8">
              <button
                type="button"
                onClick={() => setCreateJobView('options')}
                className="type-caption theme-muted hover:text-ez-accent flex items-center gap-1.5 mb-6"
              >
                <FaIcon icon="arrow-left" size={12} /> Back
              </button>
              <h2 className="type-card-title theme-heading mb-1">Paste job description</h2>
              <p className="type-body theme-muted mb-5">Drop in the full JD — AI will extract title, skills, and filters.</p>
              <textarea
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
                rows={12}
                placeholder="Paste the full job description here..."
                className="theme-input type-input border rounded-xl px-4 py-3 w-full focus:outline-none focus:ring-2 focus:ring-[#2d6a84] focus:border-transparent resize-none"
              />
              <button
                type="button"
                onClick={runJobParsing}
                disabled={!jobDescription.trim() || extracting}
                className="type-button mt-5 bg-[#2d6a84] hover:bg-[#235470] text-white rounded-xl py-3 px-6 flex items-center gap-2 disabled:opacity-50"
              >
                <FaIcon icon="robot" size={16} />
                Parse with AI
              </button>
            </div>
          )}

          {createJobView === 'upload' && (
            <div className="dashboard-card rounded-3xl p-8">
              <button
                type="button"
                onClick={() => setCreateJobView('options')}
                className="type-caption theme-muted hover:text-ez-accent flex items-center gap-1.5 mb-6"
              >
                <FaIcon icon="arrow-left" size={12} /> Back
              </button>
              <h2 className="type-card-title theme-heading mb-1">Upload job description</h2>
              <p className="type-body theme-muted mb-5">We&apos;ll parse the file and pre-fill the job form for you.</p>
              <input
                ref={jdFileInputRef}
                type="file"
                accept=".pdf,.doc,.docx,.txt"
                className="hidden"
                onChange={handleJdFileUpload}
              />
              <button
                type="button"
                onClick={() => jdFileInputRef.current?.click()}
                className="dashboard-create-card w-full border-2 border-dashed rounded-2xl py-14 flex flex-col items-center justify-center gap-3 bg-transparent hover:border-[#2d6a84]/40 transition-colors"
              >
                <div className="dashboard-create-icon w-14 h-14 rounded-full flex items-center justify-center">
                  <FaIcon icon="cloud-arrow-up" size={26} className="theme-muted" />
                </div>
                <p className="type-subheading theme-heading">Click to upload</p>
                <p className="type-caption theme-muted">PDF, DOC, DOCX, or TXT</p>
              </button>
            </div>
          )}

          {createJobView === 'parsing' && (
            <div className="dashboard-card rounded-3xl py-16 px-8 flex flex-col items-center text-center">
              <div className="job-parse-loader w-16 h-16 rounded-2xl setup-icon-wrap flex items-center justify-center mb-6">
                <FaIcon icon="robot" size={28} className="text-ez-accent" />
              </div>
              <h2 className="type-card-title theme-heading">Parsing job description…</h2>
              <p className="type-body theme-muted mt-2 max-w-sm">
                AI is extracting title, experience, skills, and inbox keywords.
              </p>
              <div className="job-parse-bar mt-8 w-full max-w-xs h-1.5 rounded-full dashboard-progress-track overflow-hidden">
                <div className="job-parse-bar-fill h-full rounded-full bg-[#2d6a84]" />
              </div>
            </div>
          )}

          {createJobView === 'form' && (
            <CreateJobDetailsForm
              extractedFields={extractedFields}
              onFieldsChange={setExtractedFields}
              scanFromDate={scanFromDate}
              scanToDate={scanToDate}
              onScanDatesChange={(from, to) => {
                setScanFromDate(from)
                setScanToDate(to)
              }}
              jobFormErrors={jobFormErrors}
              jobFormReady={jobFormReady}
              jobSubmitting={jobSubmitting}
              aiPrefilled={extracted && extractedFields.primarySkillsText.trim().length > 0}
              onChangeSource={() => setCreateJobView('source')}
              onBack={() => setCreateJobView('options')}
              onSubmit={submitJob}
            />
          )}
        </main>

        <GmailSourcePickerModal
          open={gmailSourcePickerOpen}
          options={availableSources.gmail}
          onSelect={(connectionId) => proceedToJobDetailsForm('gmail', connectionId)}
          onClose={() => setGmailSourcePickerOpen(false)}
        />

        <DriveFolderModal
          open={driveFolderOpen}
          loading={driveFolderLoading}
          foldersLoading={driveFoldersLoading}
          folders={driveFolders}
          selectedId={driveFolderId}
          onSelect={setDriveFolderId}
          onConfirm={handleDriveFolderConfirm}
          onClose={() => !driveFolderLoading && setDriveFolderOpen(false)}
        />

        <AssignInboxModal
          open={assignInboxOpen}
          email={assignInboxEmail}
          loading={assignInboxLoading}
          members={teamMembers}
          selectedId={selectedTeamMemberId}
          onSelect={setSelectedTeamMemberId}
          onSkip={handleSkipAssignInbox}
          onAssign={handleAssignInbox}
        />

        <AppToast toast={inboxToast} onClose={() => setInboxToast(null)} />
      </div>
    )
  }

  /* ─── SCREEN: CANDIDATES ─── */
  if (currentScreen === 'candidates') {
    return (
      <div className="page-bg">
        <div className="theme-nav border-b px-8 py-4 flex items-center justify-between sticky top-0 z-10">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => {
                if (scanTimersRef.current) {
                  scanTimersRef.current.timeouts.forEach(clearTimeout)
                  clearInterval(scanTimersRef.current.cvInterval)
                  scanTimersRef.current = null
                }
                setGmailScanning(false)
                setRevealedCandidateIds([])
                setScannedCvCount(0)
                setCurrentScreen('dashboard')
              }}
              className="theme-toggle w-8 h-8 rounded-lg flex items-center justify-center"
            >
              <FaIcon icon="arrow-left" size={16} />
            </button>
            <div>
              <p className="type-label theme-muted">Jobs › Portfolio</p>
              <h1 className="type-card-title theme-heading">{activeJobRequirements.title}</h1>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <ThemeSwitcher theme={theme} onChange={setTheme} />
            <div className="border-l pl-4 profile-menu-wrap portfolio-nav-divider">
              <ProfileMenu userName={authUserName} onLogout={handleLogout} />
            </div>
          </div>
        </div>

        <div className="flex gap-6 px-10 py-6">
          <div className="dashboard-card portfolio-sidebar-scroll w-80 flex-shrink-0 rounded-2xl p-4 sticky top-24 max-h-[calc(100vh-120px)] overflow-y-auto">
            <div className="relative mb-3">
              <FaIcon icon="magnifying-glass" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 theme-muted" />
              <input
                type="text"
                placeholder="Search candidates..."
                className="theme-input type-input border rounded-xl pl-9 pr-10 py-2.5 w-full focus:outline-none focus:ring-2 focus:ring-[#2d6a84] focus:border-transparent"
              />
              <FaIcon icon="sliders" size={14} className="absolute right-3 top-1/2 -translate-y-1/2 theme-muted" />
            </div>

            {sidebarCandidates.length > 0 && (
              <div className="portfolio-email-toolbar mb-3">
                <button
                  type="button"
                  onClick={toggleSelectAllSidebar}
                  className="portfolio-email-select-all type-caption theme-muted"
                >
                  <span className={`portfolio-email-checkbox ${allSidebarSelected ? 'portfolio-email-checkbox-checked' : ''}`} aria-hidden="true">
                    {allSidebarSelected && <FaIcon icon="check" size={10} />}
                  </span>
                  {allSidebarSelected ? 'Deselect all' : 'Select all'}
                </button>
                {emailSelectedIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => openEmailModal(emailSelectedIds)}
                    className="portfolio-email-send-btn type-caption"
                  >
                    <FaIcon icon="envelope" size={12} />
                    Send email ({emailSelectedIds.length})
                  </button>
                )}
              </div>
            )}

            {candidatesLoading && (
              <CandidateSidebarSkeleton />
            )}

            {showCandidateScanWaiting && (
              <CandidatesLoadingState className="py-6 px-2" />
            )}

            {!candidatesLoading && !showCandidateScanWaiting && sidebarCandidates.length === 0 && (
              <p className="type-caption theme-muted py-6 text-center">No candidates yet</p>
            )}

            {sidebarCandidates.map((c) => (
              <div
                key={c.id}
                className={`portfolio-candidate-item portfolio-candidate-reveal w-full flex items-center gap-3 py-3 px-2 rounded-xl mb-1 ${
                  selectedCandidate === c.id ? 'portfolio-candidate-item-selected' : ''
                } ${emailSelectedIds.includes(c.id) ? 'portfolio-candidate-item-email-selected' : ''} ${c.stage === 'Rejected' ? 'opacity-60' : ''}`}
              >
                <button
                  type="button"
                  aria-label={`Select ${c.name} for email`}
                  aria-pressed={emailSelectedIds.includes(c.id)}
                  onClick={(e) => toggleEmailSelection(c.id, e)}
                  className={`portfolio-email-checkbox flex-shrink-0 ${emailSelectedIds.includes(c.id) ? 'portfolio-email-checkbox-checked' : ''}`}
                >
                  {emailSelectedIds.includes(c.id) && <FaIcon icon="check" size={10} />}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedCandidate(c.id)}
                  className="flex flex-1 items-center gap-3 min-w-0 text-left"
                >
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${scoreCircleStyle(c.score)}`}>
                  {c.score}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="type-subheading theme-heading truncate">{c.name}</p>
                    {c.score >= 80 && c.stage !== 'Rejected' && (
                      <span className="text-[8px] bg-[#2d6a84] text-white px-1.5 py-0.5 rounded font-bold flex-shrink-0">TOP MATCH</span>
                    )}
                  </div>
                  <p className="type-caption theme-muted truncate">{c.exp} · {c.location} · {c.primary.slice(0, 2).join('/')}</p>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full inline-block mt-1 ${stageBadgeStyle(c.stage)}`}>
                    STAGE: {c.stage.toUpperCase()}
                  </span>
                </div>
                </button>
              </div>
            ))}
          </div>

          <div className="flex-1">
            {!selected ? (
              candidatesLoading ? (
                <CandidateDetailSkeleton className="dashboard-card rounded-2xl p-8 min-h-[500px]" />
              ) : showCandidateScanWaiting ? (
                <CandidatesLoadingState className="dashboard-card rounded-2xl p-8 min-h-[500px]" />
              ) : (
                <div className="dashboard-card rounded-2xl p-8 flex flex-col items-center justify-center min-h-[500px]">
                  <FaIcon icon="user" size={48} className="mb-4 opacity-40" />
                  <p className="type-body theme-muted">Select a candidate</p>
                </div>
              )
            ) : (
              <CandidateDetailView
                candidate={selected}
                job={activeJobRequirements}
                onSaveNote={handleSaveCandidateNote}
                onUpdateStage={updateStage}
                onOpenResume={() => setResumeViewerOpen(true)}
                onSendEmail={openEmailModal}
              />
            )}
          </div>
        </div>

        <ResumePdfModal
          open={resumeViewerOpen && !!selected}
          applicationId={selected?.applicationId || selected?.id}
          candidateName={selected?.name}
          matchPercent={selected ? getCandidateMatchPercent(selected) : null}
          highlightTerms={selected?.highlightTerms || []}
          onClose={() => setResumeViewerOpen(false)}
          onError={(message) => showErrorToast(message)}
        />

        <CandidateEmailModal
          open={emailModalOpen}
          recipients={emailRecipients}
          job={activeJobRequirements}
          onClose={() => setEmailModalOpen(false)}
          onSent={handleEmailSent}
          onSendEmail={handleSendCandidateEmail}
        />

        {emailSentNotice && (
          <div className="candidate-email-toast" role="status">
            <FaIcon icon="circle-check" size={16} />
            <span>
              Email sent to {emailSentNotice.count} candidate{emailSentNotice.count > 1 ? 's' : ''}
            </span>
          </div>
        )}

        <footer className="border-t portfolio-nav-divider px-10 py-4 flex items-center justify-between type-label theme-footer">
          <span>InboxHire SYSTEM STATUS: OPERATIONAL</span>
          <span>LAST SCAN: 4 MINS AGO</span>
        </footer>
      </div>
    )
  }

  /* ─── SCREEN 3 & 4: DASHBOARD ─── */
  if (chatbotOpen) {
    return (
      <CandidateChatbot
        candidates={candidates}
        job={activeJobRequirements}
        onSaveNote={handleSaveCandidateNote}
        onUpdateStage={updateStage}
        onResumeError={(message) => showErrorToast(message)}
        theme={theme}
        onThemeChange={setTheme}
        onClose={() => setChatbotOpen(false)}
      />
    )
  }

  const dashboardJobsUsed = workspaceUsage.jobsUsed ?? 0
  const dashboardJobsMax = workspaceUsage.jobsMax ?? 0
  const dashboardJobsRemaining = Math.max(0, dashboardJobsMax - dashboardJobsUsed)
  const dashboardJobsBarPct = dashboardJobsMax > 0
    ? Math.min(100, Math.round((dashboardJobsUsed / dashboardJobsMax) * 100))
    : 0

  return (
    <div className="page-bg">
      <DashboardNavbar />

      <main className="px-10 py-8 max-w-6xl mx-auto">
        <div className="flex justify-between items-start mb-8">
          <div>
            {billingLoading ? (
              <>
                <Skeleton className="ez-skeleton-hero" />
                <Skeleton className="ez-skeleton-line ez-skeleton-line-md mt-3" />
              </>
            ) : (
              <>
                <h1 className="type-hero theme-heading">Hi, {dashboardFirstName}. Your shortlist is now ready.</h1>
                <p className="type-subheading theme-muted mt-2">
                  InboxHire has ranked them. You just need to pick the best ones.
                </p>
              </>
            )}
          </div>

          <div className="dashboard-card rounded-2xl p-5 w-72">
            <div className="flex items-center justify-between">
              <span className="type-label theme-muted">MONTHLY JOB LIMIT</span>
              <div className="dashboard-stat-accent w-8 h-8 rounded-lg flex items-center justify-center">
                <FaIcon icon="bolt" size={16} />
              </div>
            </div>
            {billingLoading ? (
              <DashboardJobLimitSkeleton />
            ) : (
              <>
                <p className="type-section theme-heading mt-2">
                  {dashboardJobsUsed}/{dashboardJobsMax} used
                </p>
                <div className="dashboard-progress-track mt-3 h-2 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#e8824a] rounded-full transition-all duration-300"
                    style={{ width: `${dashboardJobsBarPct}%` }}
                  />
                </div>
                <div className="mt-2 flex justify-between">
                  <span className="type-caption theme-muted">
                    {dashboardJobsRemaining} job{dashboardJobsRemaining === 1 ? '' : 's'} remaining
                  </span>
                  <button
                    type="button"
                    onClick={openUpgradePlan}
                    className="type-caption font-semibold text-[#2d6a84] cursor-pointer hover:underline"
                  >
                    Upgrade Plan
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex gap-2 items-center mb-5">
          <FaIcon icon="table-cells" size={18} className="text-ez-accent" />
          <h2 className="type-card-title theme-heading">Active Job Portfolios</h2>
        </div>

        <div className="grid grid-cols-3 gap-5">
          <button
            type="button"
            onClick={openCreateJob}
            className="dashboard-create-card create-job-card rounded-2xl flex flex-col items-center justify-center py-12 cursor-pointer"
          >
            <CreateJobGuideIcon />
            <p className="type-card-title theme-heading mt-4">Create New Job</p>
            <p className="type-body text-center theme-muted mt-1 px-6">
              Paste a JD or upload a file to start scanning with AI.
            </p>
          </button>

          {billingLoading ? (
            <>
              <JobPortfolioCardSkeleton />
              <JobPortfolioCardSkeleton />
            </>
          ) : (
            <>
              {dashboardJobs.map((job) => (
                <JobPortfolioCard
                  key={job.id}
                  job={job}
                  scanning={scanningJobId === job.id}
                  onScanNow={() => handleScanNow(job.id)}
                  onPause={() => handlePauseJob(job.id)}
                  onResume={() => handleResumeJob(job.id)}
                  onClose={() => handleCloseJob(job.id)}
                  onReopen={() => handleReopenJob(job.id)}
                  onEdit={() => openEditJobModal(job)}
                  onDelete={() => handleDeleteJob(job.id)}
                  onReview={() => openCandidatesForJob(job.id)}
                />
              ))}

              {Array.from({ length: Math.max(0, JOB_PORTFOLIO_MOCKUP_SLOTS - dashboardJobs.length) }, (_, index) => (
                <JobPortfolioCardMockup key={`job-mockup-${index}`} />
              ))}
            </>
          )}
        </div>

        <div className="dashboard-cta mt-8 rounded-3xl py-12 px-8 flex flex-col items-center text-center">
          <div className="dashboard-ezrecruit-logo mb-5">
            <img
              src="/images/ezrecruit-logo-light.png"
              alt="ezRecruit"
              className="dashboard-ezrecruit-logo-img dashboard-ezrecruit-logo-img--light"
            />
            <img
              src="/images/ezrecruit-logo-dark.png"
              alt=""
              aria-hidden="true"
              className="dashboard-ezrecruit-logo-img dashboard-ezrecruit-logo-img--dark"
            />
          </div>
          <h3 className="type-section theme-heading">Your shortlist is ready. What happens next?</h3>
          <p className="type-body theme-muted mt-2 max-w-lg">
            Great candidates get lost without a proper pipeline.
            ezRecruit picks up where InboxHire ends — track every candidate from shortlist to offer letter.
          </p>
          <a
            href="https://ezrecruit.ai/"
            target="_blank"
            rel="noopener noreferrer"
            className="type-button text-ez-accent mt-4 hover:underline"
          >
            Explore ezRecruit →
          </a>
        </div>
      </main>

      <DashboardFooter />

      <RequirementStatusModal
        open={!!requirementPopup}
        isActive={requirementPopup?.isActive ?? true}
        jobTitle={requirementPopup?.jobTitle ?? ''}
        onClose={() => setRequirementPopup(null)}
      />

      <EditJobModal
        open={editJobOpen}
        fields={editJobFields}
        scanFromDate={editScanFromDate}
        scanToDate={editScanToDate}
        errors={editJobErrors}
        saving={editJobSaving}
        onFieldsChange={setEditJobFields}
        onScanDatesChange={(from, to) => {
          setEditScanFromDate(from)
          setEditScanToDate(to)
        }}
        onSave={saveJobEdit}
        onClose={() => !editJobSaving && setEditJobOpen(false)}
      />

      <UpgradePlanModal
        open={upgradePlanOpen}
        selectedPlanId={selectedPlanId}
        upgradePlans={billingPlans}
        currentPlanId={workspaceUsage.planId}
        isOnDemoPlan={workspaceUsage.isDemo}
        onSelectPlan={setSelectedPlanId}
        onPaymentVerified={handlePlanPaymentVerified}
        onError={showErrorToast}
        onClose={() => {
          setUpgradePlanOpen(false)
          setSelectedPlanId(billingPlans[0]?.id ?? 'starter')
        }}
      />

      <PaymentSuccessCelebration
        celebration={paymentCelebration}
        onClose={() => setPaymentCelebration(null)}
      />

      <DashboardTodosPanel
        open={todosPanelOpen}
        todos={dashboardTodos}
        onTodosChange={(nextTodos) => {
          setDashboardTodos(nextTodos)
          try {
            localStorage.setItem(DASHBOARD_TODOS_STORAGE_KEY, JSON.stringify(nextTodos))
          } catch {
            /* ignore storage errors */
          }
        }}
        onClose={() => setTodosPanelOpen(false)}
      />

      <DashboardSideRail
        pendingCount={dashboardTodos.filter((t) => !t.done).length}
        todosOpen={todosPanelOpen}
        onOpenTodos={() => setTodosPanelOpen(true)}
        onOpenScoring={() => {
          setTodosPanelOpen(false)
          setWorkspaceInitialTab('scoring')
          setCurrentScreen('workspace')
        }}
      />

      <DashboardMascotDock
        onSearch={() => setChatbotOpen(true)}
        onWhatsApp={() => {
          window.open('https://wa.me/?text=Hi%20InboxHire%2C%20I%20need%20help.', '_blank', 'noopener,noreferrer')
        }}
        onSettings={() => setCurrentScreen('workspace')}
      />

      <AppToast toast={inboxToast} onClose={() => setInboxToast(null)} />
    </div>
  )
}
