/**
 * Empty-state drawing: a desk with a rolled plan and the outline of a building waiting to be placed.
 * Paths from public/loaders/vacio-escritorio.svg (generated with AI in Higgsfield, 21 Nov 2026),
 * cropped to the drawing and coloured with the theme (lines in --muted, the building in --brand),
 * with strokes that keep their width at any size. Decorative.
 */
export function EmptyArt({ width = 200, className }: { width?: number; className?: string }) {
  return <svg className={"empty-art" + (className ? " " + className : "")} viewBox="226 396 612 440" width={width} height={Math.round(width * 440 / 612)}
    aria-hidden="true" focusable="false" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <g className="empty-art-desk">
      <path d="M241 518 690 479 822 636 355 689Z" />
      <path d="M241 518V537L355 709 822 656V636" />
      <path d="M355 689V709" />
      <path d="M281 598 248 789H268L307 638" />
      <path d="M373 707 358 822H378L399 704" />
      <path d="M766 663 801 784H781L739 666" />
      <path d="M274 753 364 795" />
      <path d="M405 746 754 707" />
    </g>
    <g className="empty-art-desk">
      <path d="M298 516 672 487Q685 486 692 499L776 613Q782 623 770 627L423 667Q388 673 372 648L281 548Z" />
      <path d="M372 648 285 516Q273 498 285 481Q297 465 315 474Q322 478 328 488L421 626" />
      <path d="M372 648C354 614 389 588 413 609C435 629 422 655 403 652C387 650 386 630 400 627Q407 625 412 630L394 604" />
    </g>
    <g className="empty-art-place">
      <path d="M467 578 560 544 677 578 583 614Z" />
    </g>
    <g className="empty-art-building">
      <path d="M482 479 565 450 651 479V553L568 586 482 557Z" />
      <path d="M482 479 568 507 651 479M568 507V586" />
      <path d="M469 440 551 411 638 437 555 468Z" />
      <path d="M469 440V489L555 517 638 486V437M555 468V517" />
      <path d="M483 457 538 475V495L483 477ZM501 463V483M520 469V489" />
      <path d="M590 577V535L628 521V562" />
      <path d="M505 508V564M535 518V574" />
    </g>
  </svg>;
}
