import { ISO8601 } from "../common";

export type Activity = {
  windowStart: ISO8601
  windowEnd: ISO8601
  motionCount: number
}

export type PostActivityRequest = Activity

export type PostActivityResponse = {
  recordedAt: ISO8601
}

export type GetActivitiesQuery = {
  from: ISO8601
  to: ISO8601
}

export type GetActivitiesResponse = {
  deviceId: string
  activities: Activity[]
}