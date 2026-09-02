<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Model;
class Article extends Model { protected $table='articles'; protected $fillable=['title','slug','content','status','cover_path','seo_title','seo_description','og_title','og_description']; }
