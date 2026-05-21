"use client";

import { useEffect, use } from "react";
import { useRouter } from "next/navigation";

export default function ReadingRoomRedirectNovelPage(props: { params: Promise<{ id: string }> }) {
    const params = use(props.params);
    const router = useRouter();

    useEffect(() => {
        router.replace(`/reader/${params.id}`);
    }, [params.id, router]);

    return null;
}
