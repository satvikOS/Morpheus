export default function MorpheusLogo({ size = 38, className = "" }: { size?: number; className?: string }) {
  return <svg className={`morpheus-mark-vector ${className}`} style={{ width: size, height: size, minWidth: size }} width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="Morpheus">
    <path fill="currentColor" fillRule="evenodd" d="M33 5C47 8 57 20 57 34c0 15-10 25-25 25C18 59 7 49 7 34 7 19 19 8 33 5Zm-2 11c-10 4-16 10-16 18 0 11 7 17 17 17 9 0 17-6 17-16 0-7-4-14-11-18l-9 23-9-5 11-19Z" />
  </svg>;
}
