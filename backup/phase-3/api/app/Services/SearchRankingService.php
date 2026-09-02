<?php
namespace App\Services;
use App\Models\Business;
class SearchRankingService { public function score(Business $business, ?string $term=null): int { $score=0; if($term && mb_strtolower($business->name)===mb_strtolower($term))$score+=100; if(in_array('verified',(array)$business->badges,true))$score+=20; if($business->description)$score+=5; if($business->phone)$score+=5; if($business->address)$score+=5; return $score; } }
