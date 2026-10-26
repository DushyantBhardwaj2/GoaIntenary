export type ReelIdeaInput = {
  title: string;
  kind: 'reel' | 'photo';
  instagramUrl: string | null;
  location: string;
  notes: string;
  participantUserIds: string[];
};

export type ReelIdea = ReelIdeaInput & {
  id: string;
  tripId: string;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};
