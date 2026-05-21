"use client";

import { useEffect, use } from "react";
import { useRouter } from "next/navigation";

export default function ReadingRoomRedirectChapterPage(props: { params: Promise<{ id: string, chapterIdx: string }> }) {
    const params = use(props.params);
    const router = useRouter();

    useEffect(() => {
        router.replace(`/reader/${params.id}/${params.chapterIdx}`);
    }, [params.id, params.chapterIdx, router]);

    return null;
}
