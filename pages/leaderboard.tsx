import React, { useContext, useEffect, useMemo, useState } from "react";
import ChipList from "../components/UI/ChipList";
import RankCard from "../components/leaderboard/RankCard";
import ChevronRight from "../public/icons/ChevronRightIcon.svg";
import ChevronLeft from "../public/icons/ChevronLeftIcon.svg";
import BottomArrow from "../public/icons/dropdownArrow.svg";
import Image from "next/image";
import {
  fetchLeaderboardRankings,
  fetchLeaderboardToppers,
} from "../services/apiService";
import { calculatePercentile } from "../utils/numberService";
import styles from "../styles/leaderboard.module.css";
import { useAccount } from "@starknet-react/core";
import LeaderboardSkeleton from "../components/skeletons/leaderboardSkeleton";
import FeaturedQuest from "../components/UI/featured_banner/featuredQuest";
import { QuestsContext } from "../context/QuestsProvider";
import { useRouter } from "next/router";
import Searchbar from "../components/leaderboard/searchbar";
import { getDomainWithoutStark, minifyAddress } from "../utils/stringService";
import { getDomainFromAddress } from "../utils/domainService";
import { decimalToHex, hexToDecimal } from "../utils/feltService";
import { useDebounce } from "../hooks/useDebounce";
import { Abi, Contract, Provider } from "starknet";
import naming_abi from "../abi/naming_abi.json";
import { StarknetIdJsContext } from "../context/StarknetIdJsProvider";
import { utils } from "starknetid.js";
import { isStarkDomain } from "starknetid.js/packages/core/dist/utils";
import Divider from "@mui/material/Divider";
import Blur from "../components/shapes/blur";
import RankingsTable from "../components/leaderboard/RankingsTable";
import { timeFrameMap } from "../utils/constants";
import ControlsDashboard from "../components/leaderboard/ControlsDashboard";

export default function Leaderboard() {
  const router = useRouter();
  const { address: userAddress } = useAccount();
  const { featuredQuest } = useContext(QuestsContext);

  const [duration, setDuration] = useState<string>("Last 7 Days");
  const [userPercentile, setUserPercentile] = useState<number>(100);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const searchAddress = useDebounce<string>(searchQuery, 200);
  const [currentSearchedAddress, setCurrentSearchedAddress] =
    useState<string>("");
  const [rowsPerPage, setRowsPerPage] = useState<number>(10);
  const [currentPage, setCurrentPage] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [searchResults, setSearchResults] = useState<string[]>([]);
  const { starknetIdNavigator } = useContext(StarknetIdJsContext);
  const [paginationLoading, setPaginationLoading] = useState<boolean>(false);
  const [ranking, setRanking] = useState<RankingData>({
    first_elt_position: 0,
    ranking: [],
  });
  const [leaderboardToppers, setLeaderboardToppers] =
    useState<LeaderboardToppersData>({
      weekly: {
        best_users: [],
        length: 0,
      },
      monthly: {
        best_users: [],
        length: 0,
      },
      all_time: {
        best_users: [],
        length: 0,
      },
    });

  const contract = useMemo(() => {
    return new Contract(
      naming_abi as Abi,
      process.env.NEXT_PUBLIC_NAMING_CONTRACT as string,
      starknetIdNavigator?.provider as Provider
    );
  }, [starknetIdNavigator?.provider]);

  // contract call to check if typed domain is taken
  async function verifyDomain(domain: string): Promise<{ message: boolean }> {
    if (!domain) return { message: false };
    const currentTimeStamp = new Date().getTime() / 1000;
    const encoded = utils.encodeDomain(domain).map((elem) => elem.toString());
    const res = await contract?.call("domain_to_expiry", [encoded]);
    if (Number(res?.["expiry" as keyof typeof res]) < currentTimeStamp) {
      return {
        message: false,
      };
    } else {
      return {
        message: true,
      };
    }
  }

  // on user selecting duration
  const handleChangeSelection = (title: string) => {
    setDuration(title);
  };

  // on user typing
  const handleChange = (query: string) => {
    setSearchQuery(query);
  };

  // this will be called when the search address is debounced and updated and suggestions will be loaded
  useEffect(() => {
    const checkIfValidAddress = async (address: string) => {
      try {
        let domain = address;
        if (isStarkDomain(address)) {
          domain = getDomainWithoutStark(address);
        }
        const res: { message: boolean } = await verifyDomain(domain);
        if (res.message) {
          setSearchResults([domain.concat(".stark")]);
        } else {
          setSearchResults([]);
        }
      } catch (err) {
        console.log(err);
        setSearchResults([]);
      }
    };

    if (searchAddress.length > 0) {
      checkIfValidAddress(searchAddress);
    }
  }, [searchAddress]);

  // on user Press enter
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter") {
      setSearchQuery(searchQuery);
      setCurrentSearchedAddress(searchQuery);
    }
  };

  // fetch initial data on page load
  useEffect(() => {
    const makeCall = async () => {
      setLoading(true);
      const address =
        currentSearchedAddress.length > 0
          ? hexToDecimal(currentSearchedAddress)
          : userAddress
          ? hexToDecimal(userAddress)
          : "";
      const requestBody = {
        addr: address,
        page_size: rowsPerPage,
        shift: currentPage,
        start_timestamp: new Date().setDate(new Date().getDate() - 7),
        end_timestamp: new Date().getTime(),
      };

      const rankingData = await fetchLeaderboardRankings(requestBody);
      const topperData = await fetchLeaderboardToppers({
        addr: address,
      });

      setRanking(rankingData);
      setLeaderboardToppers(topperData);
      setLoading(false);
    };

    makeCall();
  }, [currentSearchedAddress]);

  // function to calculate time range based on duration
  const getTimeRange = () => {
    switch (duration) {
      case "Last 7 Days":
        return {
          start_timestamp: new Date().setDate(new Date().getDate() - 7),
          end_timestamp: new Date().getTime(),
        };
      case "Last 30 Days":
        return {
          start_timestamp: new Date().setDate(new Date().getDate() - 30),
          end_timestamp: new Date().getTime(),
        };
      case "All time":
        return {
          start_timestamp: 0,
          end_timestamp: new Date().getTime(),
        };
      default:
        // be default return weekly data
        return {
          start_timestamp: new Date().setDate(new Date().getDate() - 7),
          end_timestamp: new Date().getTime(),
        };
    }
  };

  /*
    fetch data whenever page size , page number changes, 
    duration  changes, search address changes
  */
  useEffect(() => {
    const requestBody = {
      addr:
        currentSearchedAddress.length > 0
          ? hexToDecimal(currentSearchedAddress)
          : userAddress
          ? hexToDecimal(userAddress)
          : "",
      page_size: rowsPerPage,
      shift: currentPage,
      ...getTimeRange(),
    };

    const fetchRankings = async () => {
      setPaginationLoading(true);
      const rankingData = await fetchLeaderboardRankings(requestBody);
      setRanking(rankingData);
    };

    fetchRankings();
  }, [rowsPerPage, currentPage, duration]);

  // handle pagination with forward and backward direction as params
  const handlePagination = (type: string) => {
    if (type === "next") {
      setCurrentPage((prev) => prev + 1);
    } else {
      // type==='prev' is this case
      setCurrentPage((prev) => prev - 1);
    }
  };

  // used to calculate user percentile as soon as required data is fetched
  useEffect(() => {
    // check if the user has position on the leaderboard
    if (
      !leaderboardToppers?.[
        timeFrameMap[
          duration as keyof typeof timeFrameMap
        ] as keyof typeof leaderboardToppers
      ]?.position
    ) {
      setUserPercentile(-1);
      return;
    }

    // calculate user percentile
    const res = calculatePercentile(
      leaderboardToppers[
        timeFrameMap[
          duration as keyof typeof timeFrameMap
        ] as keyof typeof leaderboardToppers
      ]?.position ?? 0,
      leaderboardToppers[
        timeFrameMap[
          duration as keyof typeof timeFrameMap
        ] as keyof typeof leaderboardToppers
      ]?.length ?? 0
    );
    setUserPercentile(res);
  }, [leaderboardToppers]);

  return (
    <div className={styles.leaderboard_container}>
      {loading ? (
        <div className={styles.leaderboard_skeleton}>
          <LeaderboardSkeleton />
        </div>
      ) : (
        <>
          <div className={styles.leaderboard_quest_banner}>
            <div className={styles.blur1}>
              <Blur green />
            </div>
            <div className={styles.blur2}>
              <Blur green />
            </div>

            <FeaturedQuest
              heading="Are you ready for this quest?"
              key={featuredQuest?.id}
              title={featuredQuest?.title_card}
              onClick={() => router.push(`/quest/${featuredQuest?.id}`)}
              imgSrc={featuredQuest?.img_card}
              issuer={{
                name: featuredQuest?.issuer ?? "",
                logoFavicon: featuredQuest?.logo ?? "",
              }}
              reward={featuredQuest?.rewards_title}
              desc={featuredQuest?.desc}
              expiry={featuredQuest?.expiry_timestamp}
            />
          </div>
          <div className={styles.leaderboard_layout}>
            <div className={styles.leaderboard_topbar}>
              <div style={{ flex: 0.4 }}>
                <p className={styles.leaderboard_heading}>Leaderboard</p>
              </div>
              <div className={styles.leaderboard_chiplist} style={{ flex: 1 }}>
                <ChipList
                  selected={duration}
                  handleChangeSelection={handleChangeSelection}
                  tags={["Last 7 Days", "Last 30 Days", "All time"]}
                />
              </div>
              <div style={{ flex: 0.4 }}>
                <Searchbar
                  value={searchQuery}
                  handleChange={handleChange}
                  onKeyDown={handleKeyDown}
                  suggestions={searchResults}
                  handleSuggestionClick={(address) => {
                    setCurrentSearchedAddress(address);
                    setSearchResults([]);
                  }}
                />
              </div>
            </div>

            {/* this will be displayed if user is present otherwise will not be displayed */}
            {userPercentile >= 0 ? (
              <div className={styles.percentile_text_container}>
                <p className={styles.percentile_text_normal}>
                  {currentSearchedAddress.length > 0 ? "He is" : "You are "}
                </p>
                <span className={styles.percentile_text_green}>
                  &nbsp;better than {userPercentile}%&nbsp;
                </span>
                <p className={styles.percentile_text_normal}>
                  of the other players
                </p>
              </div>
            ) : null}
            <Divider
              orientation="horizontal"
              variant="fullWidth"
              className={styles.divider}
            />

            {/* this will be if searched user is not present in leaderboard or server returns 500 */}
            {ranking ? (
              <>
                <RankingsTable
                  data={ranking}
                  paginationLoading={paginationLoading}
                  setPaginationLoading={setPaginationLoading}
                  userAddress={userAddress ?? ""}
                  searchedAddress={currentSearchedAddress}
                />
                <ControlsDashboard
                  ranking={ranking}
                  handlePagination={handlePagination}
                  leaderboardToppers={leaderboardToppers}
                  rowsPerPage={rowsPerPage}
                  setRowsPerPage={setRowsPerPage}
                  duration={duration}
                />
                <Divider
                  orientation="horizontal"
                  variant="fullWidth"
                  className={styles.divider}
                />
              </>
            ) : null}

            <div className={styles.leaderboard_topper_layout}>
              {leaderboardToppers
                ? leaderboardToppers[
                    timeFrameMap[
                      duration as keyof typeof timeFrameMap
                    ] as keyof typeof leaderboardToppers
                  ]?.best_users?.map((item, index) => (
                    <RankCard
                      position={index + 1}
                      key={index}
                      name={item.address}
                      experience={item.xp}
                      trophy={item.achievements}
                    />
                  ))
                : null}
            </div>
          </div>
        </>
      )}
    </div>
  );
}