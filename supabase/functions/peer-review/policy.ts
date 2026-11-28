export class ReviewError extends Error {
  constructor(
    message: string,
    public status = 403,
  ) {
    super(message);
  }
}
export const submitted = (status: unknown) =>
  ["SUBMITTED", "REVIEWING", "REVIEWED"].includes(String(status));
export interface GroupRecord {
  classId?: string;
  status?: string;
  members?: { uid: string; name: string }[];
  memberIds?: string[];
}
export function reviewPermission(
  uid: string,
  teacherId: unknown,
  classId: string,
  targetGroupId: string,
  target: GroupRecord,
  document: { classId?: string; status?: string },
  student: { groupId?: string; name?: string } | null,
  own: GroupRecord | null,
  ownDocumentStatus?: unknown,
) {
  if (target.classId !== classId || document.classId !== classId)
    throw new ReviewError("This essay is not in this classroom.");
  if (uid === teacherId) return { canWrite: false, authorName: "" };
  const member = own?.members?.find((m) => m.uid === uid);
  if (
    !student?.groupId ||
    !own ||
    own.classId !== classId ||
    !member ||
    (own.memberIds && !own.memberIds.includes(uid))
  ) {
    throw new ReviewError("You must be a current member of this classroom.");
  }
  if (!submitted(own.status) || !submitted(ownDocumentStatus))
    throw new ReviewError(
      "Submit your group’s essay before opening peer feedback.",
    );
  if (!submitted(target.status) || !submitted(document.status))
    throw new ReviewError("This essay is not currently submitted for review.");
  return {
    canWrite: student.groupId !== targetGroupId,
    authorName: member.name || student.name || "Student",
  };
}
export function validateAnchor(text: string, anchor: unknown) {
  if (anchor === null || anchor === undefined) return null;
  if (typeof anchor !== "object")
    throw new ReviewError("Select a valid passage.", 400);
  const { start, end, quote } = anchor as {
    start: number;
    end: number;
    quote: string;
  };
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end <= start ||
    end > text.length ||
    typeof quote !== "string" ||
    !quote.trim() ||
    text.slice(start, end) !== quote
  ) {
    throw new ReviewError(
      "The selected passage no longer matches the essay. Please select it again.",
      409,
    );
  }
  return { start, end, quote };
}
